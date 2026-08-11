use app_v2_lib::models::{BoundingBox, ColorSample};
use app_v2_lib::sampler::ColorSampler;

fn rgb(width: u32, height: u32, fill: (u8, u8, u8)) -> Vec<u8> {
    let mut data = vec![0u8; width as usize * height as usize * 4];
    let (r, g, b) = fill;
    for y in 0..height {
        for x in 0..width {
            let base = ((y * width) + x) as usize * 4;
            data[base] = r;
            data[base + 1] = g;
            data[base + 2] = b;
            data[base + 3] = 255;
        }
    }
    data
}

fn make_ring(width: u32, height: u32, ring_rgb: (u8, u8, u8), center_rgb: (u8, u8, u8), border: u32) -> Vec<u8> {
    let mut data = rgb(width, height, center_rgb);
    let effective_border = border.min(width / 2).min(height / 2);
    for y in 0..height {
        for x in 0..width {
            let is_outer = x < effective_border || x >= width - effective_border || y < effective_border || y >= height - effective_border;
            if !is_outer {
                continue;
            }
            let base = ((y * width) + x) as usize * 4;
            let (r, g, b) = ring_rgb;
            data[base] = r;
            data[base + 1] = g;
            data[base + 2] = b;
            data[base + 3] = 255;
        }
    }
    data
}

#[test]
fn sampler_outer_ring_median_samples_red_pure_image() {
    let data = rgb(32, 32, (255, 0, 0));
    assert_eq!(ColorSampler::sample_outer_ring_median(&data, 32, 32, 4), [255, 0, 0]);
}

#[test]
fn sampler_outer_ring_median_prefers_ring_color_over_center() {
    let data = make_ring(33, 33, (255, 42, 7), (0, 0, 0), 5);
    assert_eq!(ColorSampler::sample_outer_ring_median(&data, 33, 33, 5), [255, 42, 7]);
}

#[test]
fn sampler_outer_ring_median_luminance_boundary_backgrounds() {
    let dark = rgb(16, 16, (20, 24, 30));
    let light = rgb(16, 16, (230, 232, 236));
    assert_eq!(ColorSampler::sample_outer_ring_median(&dark, 16, 16, 2), [20, 24, 30]);
    assert_eq!(ColorSampler::sample_outer_ring_median(&light, 16, 16, 2), [230, 232, 236]);
}

#[test]
fn sampler_outer_ring_median_empty_or_too_small_returns_black() {
    assert_eq!(ColorSampler::sample_outer_ring_median(&[], 32, 32, 4), [0, 0, 0]);
    assert_eq!(
        ColorSampler::sample_outer_ring_median(&rgb(1, 1, (99, 100, 101)), 32, 32, 4),
        [0, 0, 0]
    );
    assert_eq!(
        ColorSampler::sample_outer_ring_median(&rgb(8, 8, (1, 2, 3)), 0, 8, 1),
        [0, 0, 0]
    );
    assert_eq!(
        ColorSampler::sample_outer_ring_median(&rgb(8, 8, (1, 2, 3)), 8, 0, 1),
        [0, 0, 0]
    );
}

#[test]
fn sampler_perceived_brightness_known_values() {
    assert_eq!(ColorSampler::calc_perceived_brightness(0, 0, 0), 0.0);
    assert_eq!(
        ColorSampler::calc_perceived_brightness(255, 255, 255),
        255.0
    );
    let mid = ColorSampler::calc_perceived_brightness(128, 128, 128);
    assert!(mid >= 127.99 && mid <= 128.0);
}

#[test]
fn sampler_decide_text_color_threshold() {
    assert_eq!(ColorSampler::decide_text_color(0.0), "#FFFFFF");
    assert_eq!(ColorSampler::decide_text_color(127.0), "#FFFFFF");
    assert_eq!(ColorSampler::decide_text_color(128.0), "#000000");
    assert_eq!(ColorSampler::decide_text_color(255.0), "#000000");
}

fn make_bmp(width: u32, height: u32, fill: (u8, u8, u8)) -> Vec<u8> {
    let size = width as usize * height as usize * 4;
    let mut bmp = vec![0u8; 54 + size];
    bmp[0..2].copy_from_slice(b"BM");
    bmp[18..22].copy_from_slice(&(14usize as u32).to_le_bytes());
    let (r, g, b) = fill;
    for y in 0..height {
        for x in 0..width {
            let base = 54 + ((y * width) + x) as usize * 4;
            bmp[base] = b;
            bmp[base + 1] = g;
            bmp[base + 2] = r;
            bmp[base + 3] = 255;
        }
    }
    bmp
}

#[test]
fn sampler_from_full_bmp_uses_bgra_pixel_order_and_header_offset() {
    let bmp = make_bmp(256, 256, (88, 99, 110));
    let bbox = BoundingBox {
        x: 100,
        y: 100,
        width: 40,
        height: 40,
    };
    assert_eq!(
        ColorSampler::sample_from_full_bmp(&bmp, 256, 256, bbox, 4),
        [88, 99, 110]
    );
}

#[test]
fn sampler_from_full_bmp_prefers_bbox_ring_over_center() {
    let mut bmp = make_bmp(50, 50, (0, 0, 0));
    for y in 0..50 {
        for x in 0..50 {
            let is_edge = x < 5 || x >= 45 || y < 5 || y >= 45;
            if !is_edge {
                continue;
            }
            let base = 54 + ((y * 50) + x) as usize * 4;
            // BMP is BGRA
            bmp[base] = 9;
            bmp[base + 1] = 64;
            bmp[base + 2] = 211;
            bmp[base + 3] = 255;
        }
    }
    let bbox = BoundingBox { x: 0, y: 0, width: 50, height: 50 };
    assert_eq!(
        ColorSampler::sample_from_full_bmp(&bmp, 50, 50, bbox, 5),
        [211, 64, 9]
    );
}

#[test]
fn sampler_from_full_bmp_guard_empty_or_bad_inputs() {
    assert_eq!(
        ColorSampler::sample_from_full_bmp(
            &[],
            256,
            256,
            BoundingBox { x: 0, y: 0, width: 10, height: 10 },
            4
        ),
        [30, 32, 38]
    );
    assert_eq!(
        ColorSampler::sample_from_full_bmp(
            &make_bmp(256, 256, (1, 2, 3)),
            0,
            256,
            BoundingBox { x: 0, y: 0, width: 10, height: 10 },
            4
        ),
        [30, 32, 38]
    );
}

#[test]
fn cmd_sample_colors_core_logic_returns_color_samples_for_image_crop() {
    let image_crop = make_ring(65, 65, (13, 230, 170), (255, 0, 0), 8);
    let boxes = vec![BoundingBox { x: 0, y: 0, width: 65, height: 65 }];

    let samples = app_v2_lib::commands::cmd_sample_colors_core_logic(&image_crop, boxes).unwrap();

    assert_eq!(samples.len(), 1);
    assert_eq!(
        samples[0],
        ColorSample {
            box_rect: BoundingBox { x: 0, y: 0, width: 65, height: 65 },
            background_rgb: [13, 230, 170],
            text_color: "#000000".to_string(),
        }
    );
}

#[test]
fn cmd_sample_colors_core_logic_empty_image_uses_fallback() {
    let samples = app_v2_lib::commands::cmd_sample_colors_core_logic(
        &[],
        vec![BoundingBox { x: 10, y: 20, width: 40, height: 20 }],
    )
    .unwrap();

    assert_eq!(
        samples[0],
        ColorSample {
            box_rect: BoundingBox { x: 10, y: 20, width: 40, height: 20 },
            background_rgb: [42, 42, 42],
            text_color: "#FFFFFF".to_string(),
        }
    );
}