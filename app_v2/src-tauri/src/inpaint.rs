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
                let lum_diff = (lum - bg_lum).abs();
                // 亮度差足够大（黑白文字），或任一通道差足够大（彩色文字，
                // 如灰底红字：亮度差有限但 R 通道差异明显）
                let channel_diff = (c[0] as i32 - bg[0] as i32)
                    .abs()
                    .max((c[1] as i32 - bg[1] as i32).abs())
                    .max((c[2] as i32 - bg[2] as i32).abs());
                if lum_diff > 60.0 || channel_diff > 55 {
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

/// Grow the OCR box a few pixels so antialiased glyph edges and upper/lower strokes are completely covered too.
pub fn pad_bbox(bbox: BoundingBox, full_w: u32, full_h: u32) -> (i32, i32, i32, i32) {
    let h = bbox.height.max(1) as f32;
    let pad_x = (4.0 + h * 0.15) as i32;
    let pad_y = (2.0 + h * 0.12) as i32;
    let x0 = (bbox.x - pad_x).max(0);
    let y0 = (bbox.y - pad_y).max(0);
    let x1 = (bbox.x + bbox.width as i32 + pad_x).min(full_w as i32 - 1);
    let y1 = (bbox.y + bbox.height as i32 + pad_y).min(full_h as i32 - 1);
    (x0, y0, x1, y1)
}

/// Final erased-patch rect: the padded bbox clamped so it never crosses into a
/// neighbouring text block (`avoid` = the other blocks' boxes). Without this
/// clamp the padding erases a band out of an adjacent line, which reads on
/// screen as a strikethrough drawn through that text.
pub fn erased_patch_rect(
    bbox: BoundingBox,
    full_w: u32,
    full_h: u32,
    avoid: &[BoundingBox],
    bmp: &[u8],
) -> (i32, i32, i32, i32) {
    let (mut x0, mut y0, mut x1, mut y1) = pad_bbox(bbox, full_w, full_h);
    let self_left = bbox.x;
    let self_right = bbox.x + bbox.width as i32;
    let self_top = bbox.y;
    let self_bottom = bbox.y + bbox.height as i32;

    for n in avoid {
        let n_left = n.x;
        let n_right = n.x + n.width as i32;
        let n_top = n.y;
        let n_bottom = n.y + n.height as i32;
        let x_overlap = n_right.min(self_right) - n_left.max(self_left) > 0;
        let y_overlap = n_bottom.min(self_bottom) - n_top.max(self_top) > 0;

        if x_overlap && !y_overlap {
            if n_bottom <= self_top {
                // 上方邻行：padding 最多收到自身框顶，不吞邻行字形
                y0 = y0.max(n_bottom + 1).min(self_top);
            } else if n_top >= self_bottom {
                y1 = y1.min(n_top - 1).max(self_bottom);
            }
        } else if y_overlap && !x_overlap {
            if n_right <= self_left {
                x0 = x0.max(n_right + 1).min(self_left);
            } else if n_left >= self_right {
                x1 = x1.min(n_left - 1).max(self_right);
            }
        }
    }

    // 墨迹感知收缩:OCR 漏检的邻行文字不在 avoid 名单里,padding 外扩会把
    // 它横向抹掉一截——屏幕上呈现为"划痕"。从补丁最外圈向内逐行/列检测,
    // 碰到文字像素(亮度偏离该行中位数 >60 且占比 ≥3%)就收缩到干净处。
    // 保留 1px 余量覆盖自身抗锯齿光晕。
    let box_top = bbox.y;
    let box_bottom = bbox.y + bbox.height as i32 - 1;
    let box_left = bbox.x;
    let box_right = bbox.x + bbox.width as i32 - 1;
    while y0 < box_top - 1 && strip_edge_has_ink(bmp, full_w, x0, x1, y0, true) {
        y0 += 1;
    }
    while y1 > box_bottom + 1 && strip_edge_has_ink(bmp, full_w, x0, x1, y1, true) {
        y1 -= 1;
    }
    while x0 < box_left - 1 && strip_edge_has_ink(bmp, full_w, y0, y1, x0, false) {
        x0 += 1;
    }
    while x1 > box_right + 1 && strip_edge_has_ink(bmp, full_w, y0, y1, x1, false) {
        x1 -= 1;
    }
    (x0, y0, x1, y1)
}

/// 检查补丁某条最外边缘是否含"墨迹"(文字像素):
/// vertical=true 检查行 y=fixed 上 x∈[a,b];false 检查列 x=fixed 上 y∈[a,b]。
/// 以该条的中位亮度为背景,≥3% 像素偏离 >60 即视为有文字。
fn strip_edge_has_ink(bmp: &[u8], full_w: u32, a: i32, b: i32, fixed: i32, vertical: bool) -> bool {
    if b < a {
        return false;
    }
    let mut lums: Vec<f64> = Vec::with_capacity((b - a + 1) as usize);
    for i in a..=b {
        let (x, y) = if vertical { (i, fixed) } else { (fixed, i) };
        if let Some(p) = get_px(bmp, full_w, x, y) {
            let c = px(p);
            lums.push(crate::sampler::ColorSampler::calc_perceived_brightness(
                c[0], c[1], c[2],
            ));
        }
    }
    if lums.is_empty() {
        return false;
    }
    lums.sort_by(|p, q| p.partial_cmp(q).unwrap_or(std::cmp::Ordering::Equal));
    let med = lums[lums.len() / 2];
    let ink = lums.iter().filter(|l| (**l - med).abs() > 60.0).count();
    ink * 100 >= lums.len() * 3
}

/// Build the erased patch for one text box and encode it as a base64 PNG.
///
/// Every row of the padded box is replaced by a horizontal gradient lerping
/// between the average colour of a few pixels just left / just right of the
/// box on that same row — so horizontal AND vertical background gradients both
/// survive, and the patch's left/right edges match the screen pixel-for-pixel.
///
/// `avoid` lists the other text blocks' boxes: the rect is clamped to never
/// cross into them (see `erased_patch_rect`).
pub fn build_erased_patch_png(
    bmp: &[u8],
    full_w: u32,
    full_h: u32,
    bbox: BoundingBox,
    avoid: &[BoundingBox],
) -> Option<(String, u32, u32)> {
    if bmp.len() <= BMP_HEADER || full_w == 0 || full_h == 0 {
        return None;
    }
    let (x0, y0, x1, y1) = erased_patch_rect(bbox, full_w, full_h, avoid, bmp);
    let w = (x1 - x0 + 1).max(1) as u32;
    let h = (y1 - y0 + 1).max(1) as u32;
    if w < 2 || h < 1 || w > 4096 || h > 512 {
        return None;
    }

    // Sample the left outer column and right outer column to find their clean ambient background references.
    let mut left_col_pixels = Vec::new();
    let mut right_col_pixels = Vec::new();
    for y in y0..=y1 {
        for s in 1..=3 {
            if let Some(p) = get_px(bmp, full_w, x0 - s, y) {
                left_col_pixels.push(px(p));
            }
            if let Some(p) = get_px(bmp, full_w, x1 + s, y) {
                right_col_pixels.push(px(p));
            }
        }
    }
    let left_col_median = if !left_col_pixels.is_empty() {
        median3(left_col_pixels)
    } else {
        [245, 245, 245]
    };
    let right_col_median = if !right_col_pixels.is_empty() {
        median3(right_col_pixels)
    } else {
        left_col_median
    };

    let left_col_lum = crate::sampler::ColorSampler::calc_perceived_brightness(
        left_col_median[0],
        left_col_median[1],
        left_col_median[2],
    );
    let right_col_lum = crate::sampler::ColorSampler::calc_perceived_brightness(
        right_col_median[0],
        right_col_median[1],
        right_col_median[2],
    );

    // Any pixel that deviates strongly from the column's ambient background is "ink"
    // (such as a bullet point '•', punctuation, icon, or cursor) and must NOT be used for inpainting.
    let is_clean_left = |c: [u8; 3]| -> bool {
        let lum = crate::sampler::ColorSampler::calc_perceived_brightness(c[0], c[1], c[2]);
        let lum_diff = (lum - left_col_lum).abs();
        let col_diff = (c[0] as i32 - left_col_median[0] as i32)
            .abs()
            .max((c[1] as i32 - left_col_median[1] as i32).abs())
            .max((c[2] as i32 - left_col_median[2] as i32).abs());
        lum_diff < 45.0 && col_diff < 50
    };

    let is_clean_right = |c: [u8; 3]| -> bool {
        let lum = crate::sampler::ColorSampler::calc_perceived_brightness(c[0], c[1], c[2]);
        let lum_diff = (lum - right_col_lum).abs();
        let col_diff = (c[0] as i32 - right_col_median[0] as i32)
            .abs()
            .max((c[1] as i32 - right_col_median[1] as i32).abs())
            .max((c[2] as i32 - right_col_median[2] as i32).abs());
        lum_diff < 45.0 && col_diff < 50
    };

    const STRIP: i32 = 4; // pixels sampled outside each edge per row
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);

    for y in y0..=y1 {
        let mut left = [0u32; 3];
        let mut left_n = 0u32;
        let mut right = [0u32; 3];
        let mut right_n = 0u32;

        for s in 1..=STRIP {
            if let Some(p) = get_px(bmp, full_w, x0 - s, y) {
                let c = px(p);
                if is_clean_left(c) {
                    left[0] += c[0] as u32;
                    left[1] += c[1] as u32;
                    left[2] += c[2] as u32;
                    left_n += 1;
                }
            }
            if let Some(p) = get_px(bmp, full_w, x1 + s, y) {
                let c = px(p);
                if is_clean_right(c) {
                    right[0] += c[0] as u32;
                    right[1] += c[1] as u32;
                    right[2] += c[2] as u32;
                    right_n += 1;
                }
            }
        }

        // If a row's immediate edge hits dark ink (e.g. a bullet point '•' or colon),
        // fallback to the clean column background instead of smearing ink horizontally.
        let l = if left_n > 0 {
            [
                (left[0] / left_n) as u8,
                (left[1] / left_n) as u8,
                (left[2] / left_n) as u8,
            ]
        } else {
            left_col_median
        };

        let r = if right_n > 0 {
            [
                (right[0] / right_n) as u8,
                (right[1] / right_n) as u8,
                (right[2] / right_n) as u8,
            ]
        } else {
            right_col_median
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
        let (b64, pw, ph) = build_erased_patch_png(&bmp, w, h, bbox, &[]).unwrap();
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
    fn test_patch_rejects_adjacent_bullet_points_ink_scratch() {
        // White background, with a dark bullet point '•' located immediately left of the text bbox (x=12..16, y=18..22)
        let (bmp, w, h) = make_bmp(120, 40, |x, y| {
            if (12..16).contains(&x) && (18..22).contains(&y) {
                [20, 20, 20] // Bullet point ink
            } else if (22..90).contains(&x) && (16..24).contains(&y) {
                [30, 30, 30] // Text glyphs inside bbox
            } else {
                [250, 250, 250] // Ambient background
            }
        });
        let bbox = BoundingBox { x: 22, y: 16, width: 68, height: 8 };
        let (b64, pw, ph) = build_erased_patch_png(&bmp, w, h, bbox, &[]).unwrap();
        let img = image::load_from_memory_with_format(
            &base64::engine::general_purpose::STANDARD.decode(b64).unwrap(),
            image::ImageFormat::Png,
        )
        .unwrap()
        .to_rgba8();

        // Across all rows of the inpaint patch, the pixels must stay pure white background (>230)
        // without any dark gray scratch / stripe bleeding through from the bullet point!
        for y in 0..ph {
            for x in (pw / 4)..(pw * 3 / 4) {
                let p = img.get_pixel(x, y);
                assert!(
                    p[0] > 230 && p[1] > 230 && p[2] > 230,
                    "Pixel at ({}, {}) was tainted by bullet ink: {:?}",
                    x,
                    y,
                    p
                );
            }
        }
    }

    #[test]
    fn test_patch_follows_horizontal_gradient() {
        // Horizontal gradient 0..255 across the image, no text
        let (bmp, w, h) = make_bmp(120, 30, |x, _y| [(x * 2) as u8, (x * 2) as u8, (x * 2) as u8]);
        let bbox = BoundingBox { x: 40, y: 10, width: 40, height: 10 };
        let (b64, pw, _ph) = build_erased_patch_png(&bmp, w, h, bbox, &[]).unwrap();
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

#[cfg(test)]
mod ink_shrink_tests {
    use super::*;

    fn make_bmp_with_stripe(w: u32, h: u32, stripe_y0: i32, stripe_y1: i32) -> Vec<u8> {
        // 白底 + 指定行范围的深色"文字"条带
        let px_len = (w * h * 4) as usize;
        let mut bmp = vec![255u8; 54 + px_len];
        bmp[0] = b'B';
        bmp[1] = b'M';
        bmp[14..18].copy_from_slice(&40u32.to_le_bytes());
        bmp[18..22].copy_from_slice(&(w as i32).to_le_bytes());
        bmp[22..26].copy_from_slice(&(-(h as i32)).to_le_bytes());
        bmp[26..28].copy_from_slice(&1u16.to_le_bytes());
        bmp[28..30].copy_from_slice(&32u16.to_le_bytes());
        for y in stripe_y0.max(0)..=stripe_y1.min((h - 1) as i32) {
            for x in (10..(w - 10) as i32).step_by(3) {
                let idx = 54 + ((y as u32 * w + x as u32) * 4) as usize;
                if idx + 2 < bmp.len() {
                    bmp[idx] = 30; // B
                    bmp[idx + 1] = 30; // G
                    bmp[idx + 2] = 30; // R
                }
            }
        }
        bmp
    }

    #[test]
    fn patch_shrinks_before_unrecognized_text_above() {
        // 自身框 y 40..50;上方 y 20..26 有一条 OCR 漏检的文字
        let (bmp, w, h) = (make_bmp_with_stripe(200, 80, 20, 26), 200u32, 80u32);
        let bbox = BoundingBox { x: 30, y: 40, width: 100, height: 10 };
        let (x0, y0, _x1, _y1) = erased_patch_rect(bbox, w, h, &[], &bmp);
        // padding 默认会上探到 ~y=33;墨迹收缩后补丁顶必须不越过文字条带下缘
        assert!(y0 > 26, "补丁顶 {} 不应涂到上方漏检文字(条带 20..26)", y0);
        // 但仍保留自身框上方至少 1px 的抗锯齿余量
        assert!(y0 <= 39, "补丁顶 {} 应保留至少 1px 自身边距", y0);
        let _ = x0;
    }

    #[test]
    fn patch_keeps_full_pad_on_clean_background() {
        // 干净背景:padding 保持完整(不被误收缩)
        let (bmp, w, h) = (make_bmp_with_stripe(200, 80, -1, -2), 200u32, 80u32);
        let bbox = BoundingBox { x: 30, y: 40, width: 100, height: 10 };
        let (_, y0, _, y1) = erased_patch_rect(bbox, w, h, &[], &bmp);
        // pad_y = 2 + 10*0.12 ≈ 3 → 顶 37 底 53;断言没有收缩
        assert!(y0 <= 37, "干净背景上 padding 不应收缩,得到 y0={}", y0);
        assert!(y1 >= 53, "干净背景上 padding 不应收缩,得到 y1={}", y1);
    }
}
