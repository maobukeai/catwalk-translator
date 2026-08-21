//! Text erasure ("抹除") for the in-place screenshot translation overlay.
//!
//! The overlay window is transparent, so the original screen text is still
//! visible underneath the translated cards. To make the replacement feel
//! embedded, each text block ships with a small PNG patch: the OCR bounding
//! box region with its glyphs erased by per-row horizontal interpolation
//! between the pixels just outside the box. On solid / gradient backgrounds
//! the patch edges continue the real screen pixels exactly, so the card
//! blends seamlessly instead of looking like an opaque colour chip.

use crate::models::BoundingBox;

const BMP_HEADER: usize = 54;

#[inline]
fn px(bgra: [u8; 4]) -> [u8; 3] {
    [bgra[2], bgra[1], bgra[0]] // BGRA -> RGB
}

/// Read one BGRA pixel from the full desktop BMP (top-down 32bpp).
#[inline]
fn get_px(bmp: &[u8], full_w: u32, x: i32, y: i32) -> Option<[u8; 4]> {
    if x < 0 || y < 0 || x >= full_w as i32 {
        return None;
    }
    let idx = BMP_HEADER + ((y as u32 * full_w + x as u32) * 4) as usize;
    let end = idx + 4;
    if end > bmp.len() {
        return None;
    }
    Some([bmp[idx], bmp[idx + 1], bmp[idx + 2], bmp[idx + 3]])
}

fn median3(vals: Vec<[u8; 3]>) -> [u8; 3] {
    if vals.is_empty() {
        return [30, 32, 38];
    }
    let channel = |ci: usize| -> u8 {
        let mut col: Vec<u8> = vals.iter().map(|v| v[ci]).collect();
        col.sort_unstable();
        col[col.len() / 2]
    };
    [channel(0), channel(1), channel(2)]
}

/// Estimate the glyph (foreground) colour inside `bbox`: the background is the
/// median of the pixels in the padded ring AROUND the box (the box itself is
/// mostly ink when OCR wraps glyphs tightly), then pixels that differ strongly
/// from that background are ink and their median is the text colour. Falls back
/// to a high-contrast black/white when the box has no clear ink.
pub fn sample_text_color(bmp: &[u8], full_w: u32, full_h: u32, bbox: BoundingBox) -> [u8; 3] {
    let (x0, y0, x1, y1) = pad_bbox(bbox, full_w, full_h);
    let bx0 = bbox.x.max(0);
    let by0 = bbox.y.max(0);
    let bx1 = (bbox.x + bbox.width as i32).min(full_w as i32 - 1);
    let by1 = (bbox.y + bbox.height as i32).min(full_h as i32 - 1);

    // Background: median of padded-region pixels that lie OUTSIDE the OCR box.
    let mut ring: Vec<[u8; 3]> = Vec::new();
    for y in y0..=y1 {
        for x in x0..=x1 {
            let inside = x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
            if inside {
                continue;
            }
            if let Some(p) = get_px(bmp, full_w, x, y) {
                ring.push(px(p));
            }
        }
    }
    let bg = if ring.is_empty() {
        crate::sampler::ColorSampler::sample_from_full_bmp(bmp, full_w, full_h, bbox, 3)
    } else {
        median3(std::mem::take(&mut ring))
    };
    let bg_lum = crate::sampler::ColorSampler::calc_perceived_brightness(bg[0], bg[1], bg[2]);

    let mut ink: Vec<[u8; 3]> = Vec::new();
    for y in by0..=by1 {
        for x in bx0..=bx1 {
            if let Some(p) = get_px(bmp, full_w, x, y) {
                let c = px(p);
                let lum = crate::sampler::ColorSampler::calc_perceived_brightness(c[0], c[1], c[2]);
                if (lum - bg_lum).abs() > 60.0 {
                    ink.push(c);
                }
            }
        }
    }

    let total = ((bx1 - bx0 + 1) * (by1 - by0 + 1)).max(1);
    if (ink.len() as i32) * 100 < total * 3 {
        // <3% "ink" pixels — likely no real text in the box
        return if bg_lum < 128.0 {
            [235, 237, 240]
        } else {
            [22, 23, 27]
        };
    }
    median3(ink)
}

/// Grow the OCR box a few pixels so antialiased glyph edges are covered too.
pub fn pad_bbox(bbox: BoundingBox, full_w: u32, full_h: u32) -> (i32, i32, i32, i32) {
    let h = bbox.height.max(1) as f32;
    let pad_x = (2.0 + h * 0.14) as i32;
    let pad_y = (1.0 + h * 0.10) as i32;
    let x0 = (bbox.x - pad_x).max(0);
    let y0 = (bbox.y - pad_y).max(0);
    let x1 = (bbox.x + bbox.width as i32 + pad_x).min(full_w as i32 - 1);
    let y1 = (bbox.y + bbox.height as i32 + pad_y).min(full_h as i32 - 1);
    (x0, y0, x1, y1)
}

/// Build the erased patch for one text box and encode it as a base64 PNG.
///
/// Every row of the padded box is replaced by a horizontal gradient lerping
/// between the average colour of a few pixels just left / just right of the
/// box on that same row — so horizontal AND vertical background gradients both
/// survive, and the patch's left/right edges match the screen pixel-for-pixel.
pub fn build_erased_patch_png(
    bmp: &[u8],
    full_w: u32,
    full_h: u32,
    bbox: BoundingBox,
) -> Option<(String, u32, u32)> {
    if bmp.len() <= BMP_HEADER || full_w == 0 || full_h == 0 {
        return None;
    }
    let (x0, y0, x1, y1) = pad_bbox(bbox, full_w, full_h);
    let w = (x1 - x0 + 1).max(1) as u32;
    let h = (y1 - y0 + 1).max(1) as u32;
    if w < 2 || h < 1 || w > 4096 || h > 512 {
        return None;
    }

    const STRIP: i32 = 3; // pixels sampled outside each edge per row
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);

    for y in y0..=y1 {
        // Average the 1..STRIP pixels immediately left / right of the box.
        let mut left = [0u32; 3];
        let mut left_n = 0u32;
        let mut right = [0u32; 3];
        let mut right_n = 0u32;
        for s in 1..=STRIP {
            if let Some(p) = get_px(bmp, full_w, x0 - s, y) {
                let c = px(p);
                left[0] += c[0] as u32;
                left[1] += c[1] as u32;
                left[2] += c[2] as u32;
                left_n += 1;
            }
            if let Some(p) = get_px(bmp, full_w, x1 + s, y) {
                let c = px(p);
                right[0] += c[0] as u32;
                right[1] += c[1] as u32;
                right[2] += c[2] as u32;
                right_n += 1;
            }
        }
        let l = if left_n > 0 {
            [
                (left[0] / left_n) as u8,
                (left[1] / left_n) as u8,
                (left[2] / left_n) as u8,
            ]
        } else {
            [0, 0, 0]
        };
        let r = if right_n > 0 {
            [
                (right[0] / right_n) as u8,
                (right[1] / right_n) as u8,
                (right[2] / right_n) as u8,
            ]
        } else {
            l
        };
        // Box touching a screen edge on both sides: constant fill from the one
        // available side (or black when neither exists — practically impossible).
        let (l, r) = if left_n == 0 && right_n == 0 {
            ([30u8, 32, 38], [30u8, 32, 38])
        } else if left_n == 0 {
            (r, r)
        } else if right_n == 0 {
            (l, l)
        } else {
            (l, r)
        };

        for x in x0..=x1 {
            let t = (x - x0) as f32 / (x1 - x0).max(1) as f32;
            rgba.push((l[0] as f32 + (r[0] as f32 - l[0] as f32) * t).round() as u8);
            rgba.push((l[1] as f32 + (r[1] as f32 - l[1] as f32) * t).round() as u8);
            rgba.push((l[2] as f32 + (r[2] as f32 - l[2] as f32) * t).round() as u8);
            rgba.push(255);
        }
    }

    // Encode RGBA buffer -> PNG -> base64 data payload
    let img = image::RgbaImage::from_raw(w, h, rgba)?;
    let mut png_bytes: Vec<u8> = Vec::new();
    {
        let mut cursor = std::io::Cursor::new(&mut png_bytes);
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut cursor, image::ImageFormat::Png)
            .ok()?;
    }
    use base64::Engine as _;
    Some((
        base64::engine::general_purpose::STANDARD.encode(&png_bytes),
        w,
        h,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;

    /// Build a minimal full-desktop BMP (54-byte header + top-down 32bpp BGRA).
    fn make_bmp(w: u32, h: u32, paint: impl Fn(i32, i32) -> [u8; 3]) -> (Vec<u8>, u32, u32) {
        let px_len = (w * h * 4) as usize;
        let mut bmp = vec![0u8; 54 + px_len];
        bmp[0] = b'B';
        bmp[1] = b'M';
        bmp[14..18].copy_from_slice(&40u32.to_le_bytes());
        bmp[18..22].copy_from_slice(&(w as i32).to_le_bytes());
        bmp[22..26].copy_from_slice(&(-(h as i32)).to_le_bytes());
        bmp[26..28].copy_from_slice(&1u16.to_le_bytes());
        bmp[28..30].copy_from_slice(&32u16.to_le_bytes());
        bmp[34..38].copy_from_slice(&(px_len as u32).to_le_bytes());
        for y in 0..h as i32 {
            for x in 0..w as i32 {
                let [r, g, b] = paint(x, y);
                let idx = 54 + ((y as u32 * w + x as u32) * 4) as usize;
                bmp[idx] = b;
                bmp[idx + 1] = g;
                bmp[idx + 2] = r;
                bmp[idx + 3] = 255;
            }
        }
        (bmp, w, h)
    }

    #[test]
    fn test_patch_erases_text_on_solid_bg() {
        // White background, black glyph stripe in the middle rows
        let (bmp, w, h) = make_bmp(100, 40, |x, y| {
            if (20..80).contains(&x) && (15..25).contains(&y) {
                [10, 10, 10]
            } else {
                [250, 250, 250]
            }
        });
        let bbox = BoundingBox { x: 20, y: 15, width: 60, height: 10 };
        let (b64, pw, ph) = build_erased_patch_png(&bmp, w, h, bbox).unwrap();
        assert!(pw >= 60 && ph >= 10);
        assert!(!b64.is_empty());

        // Decode back and verify the erased interior matches the white bg
        let img = image::load_from_memory_with_format(
            &base64::engine::general_purpose::STANDARD.decode(b64).unwrap(),
            image::ImageFormat::Png,
        )
        .unwrap()
        .to_rgba8();
        let mid = img.get_pixel(pw / 2, ph / 2);
        assert!(mid[0] > 240 && mid[1] > 240 && mid[2] > 240, "center should be white, got {:?}", mid);
    }

    #[test]
    fn test_patch_follows_horizontal_gradient() {
        // Horizontal gradient 0..255 across the image, no text
        let (bmp, w, h) = make_bmp(120, 30, |x, _y| [(x * 2) as u8, (x * 2) as u8, (x * 2) as u8]);
        let bbox = BoundingBox { x: 40, y: 10, width: 40, height: 10 };
        let (b64, pw, _ph) = build_erased_patch_png(&bmp, w, h, bbox).unwrap();
        let img = image::load_from_memory_with_format(
            &base64::engine::general_purpose::STANDARD.decode(b64).unwrap(),
            image::ImageFormat::Png,
        )
        .unwrap()
        .to_rgba8();
        // Patch left edge ≈ pixel just left of the padded box; right edge ≈ just right
        let left = img.get_pixel(0, 5)[0] as i32;
        let right = img.get_pixel(pw - 1, 5)[0] as i32;
        assert!((right - left) > 60, "gradient should survive: l={} r={}", left, right);
        // And it should be roughly linear (mid ≈ average of the edges ±6)
        let mid = img.get_pixel(pw / 2, 5)[0] as i32;
        let expect = (left + right) / 2;
        assert!((mid - expect).abs() <= 6, "mid {} should ≈ {}", mid, expect);
    }

    #[test]
    fn test_sample_text_color_finds_dark_ink_on_light_bg() {
        let (bmp, w, h) = make_bmp(100, 40, |x, y| {
            if (20..80).contains(&x) && (15..25).contains(&y) {
                [40, 44, 52]
            } else {
                [245, 245, 245]
            }
        });
        let c = sample_text_color(&bmp, w, h, BoundingBox { x: 20, y: 15, width: 60, height: 10 });
        assert!(c[0] < 100 && c[1] < 100 && c[2] < 100, "ink should be dark, got {:?}", c);
    }

    #[test]
    fn test_sample_text_color_no_ink_falls_back() {
        let (bmp, w, h) = make_bmp(80, 30, |_x, _y| [200, 200, 200]);
        let c = sample_text_color(&bmp, w, h, BoundingBox { x: 10, y: 10, width: 40, height: 8 });
        // Light bg -> dark fallback text colour
        assert!(c[0] < 80, "expected dark fallback, got {:?}", c);
    }
}
