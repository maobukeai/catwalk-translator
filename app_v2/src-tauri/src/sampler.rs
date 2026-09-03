pub use crate::models::{BoundingBox, ColorSample};

pub struct ColorSampler;

impl ColorSampler {
    pub fn sample_outer_ring_median(
        image_bytes: &[u8],
        width: u32,
        height: u32,
        border_px: u32,
    ) -> [u8; 3] {
        if image_bytes.is_empty() || width == 0 || height == 0 {
            return [0, 0, 0];
        }

        let total_pixels = (width as usize) * (height as usize);
        if image_bytes.len() < total_pixels * 4 {
            return [0, 0, 0];
        }

        let mut r_vals = Vec::new();
        let mut g_vals = Vec::new();
        let mut b_vals = Vec::new();

        let border = border_px.min(width / 2).min(height / 2);

        for y in 0..height {
            for x in 0..width {
                let is_outer_ring =
                    x < border || x >= width - border || y < border || y >= height - border;

                if is_outer_ring {
                    let idx = ((y * width + x) * 4) as usize;
                    // 输入是 32bpp BMP（BGRA 字节序），此前按 RGB 直读导致红蓝颠倒
                    r_vals.push(image_bytes[idx + 2]);
                    g_vals.push(image_bytes[idx + 1]);
                    b_vals.push(image_bytes[idx]);
                }
            }
        }

        if r_vals.is_empty() {
            return [0, 0, 0];
        }

        r_vals.sort_unstable();
        g_vals.sort_unstable();
        b_vals.sort_unstable();

        let mid = r_vals.len() / 2;
        let median_r = if r_vals.len() % 2 == 0 {
            ((r_vals[mid - 1] as u16 + r_vals[mid] as u16) / 2) as u8
        } else {
            r_vals[mid]
        };

        let median_g = if g_vals.len() % 2 == 0 {
            ((g_vals[mid - 1] as u16 + g_vals[mid] as u16) / 2) as u8
        } else {
            g_vals[mid]
        };

        let median_b = if b_vals.len() % 2 == 0 {
            ((b_vals[mid - 1] as u16 + b_vals[mid] as u16) / 2) as u8
        } else {
            b_vals[mid]
        };

        [median_r, median_g, median_b]
    }

    pub fn calc_perceived_brightness(r: u8, g: u8, b: u8) -> f64 {
        0.299 * (r as f64) + 0.587 * (g as f64) + 0.114 * (b as f64)
    }

    pub fn decide_text_color(brightness: f64) -> String {
        if brightness < 128.0 {
            "#FFFFFF".to_string()
        } else {
            "#000000".to_string()
        }
    }
}

impl ColorSampler {
    /// Sample the outer-ring border pixels of `bbox` from the full desktop BMP
    /// (the BMP includes the 54-byte file+DIB header, so pixel data starts at byte 54).
    /// `full_w` / `full_h` are the BMP canvas dimensions in physical pixels.
    pub fn sample_from_full_bmp(
        full_bmp: &[u8],
        full_w: u32,
        full_h: u32,
        bbox: crate::models::BoundingBox,
        border_px: u32,
    ) -> [u8; 3] {
        const HEADER: usize = 54;
        if full_bmp.len() < HEADER || full_w == 0 || full_h == 0 {
            return [30, 32, 38]; // default dark bg
        }

        let pixels = &full_bmp[HEADER..];
        let px = bbox.x.max(0) as u32;
        let py = bbox.y.max(0) as u32;
        let pw = bbox.width.min(full_w.saturating_sub(px)).max(1);
        let ph = bbox.height.min(full_h.saturating_sub(py)).max(1);
        let border = border_px.min(pw / 2).min(ph / 2).max(1);

        let mut r_vals: Vec<u8> = Vec::new();
        let mut g_vals: Vec<u8> = Vec::new();
        let mut b_vals: Vec<u8> = Vec::new();

        for dy in 0..ph {
            for dx in 0..pw {
                let is_edge = dx < border || dx >= pw - border || dy < border || dy >= ph - border;
                if !is_edge {
                    continue;
                }
                let abs_x = px + dx;
                let abs_y = py + dy;
                if abs_x >= full_w || abs_y >= full_h {
                    continue;
                }
                let idx = ((abs_y * full_w + abs_x) * 4) as usize;
                if idx + 2 >= pixels.len() {
                    continue;
                }
                // BMP 32bpp is BGRA
                b_vals.push(pixels[idx]);
                g_vals.push(pixels[idx + 1]);
                r_vals.push(pixels[idx + 2]);
            }
        }

        if r_vals.is_empty() {
            return [30, 32, 38];
        }

        r_vals.sort_unstable();
        g_vals.sort_unstable();
        b_vals.sort_unstable();
        let mid = r_vals.len() / 2;
        [r_vals[mid], g_vals[mid], b_vals[mid]]
    }
}
