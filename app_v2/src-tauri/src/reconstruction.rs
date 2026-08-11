use crate::ocr::{BoundingBox, TextBlock};

pub struct LineClusterer;

impl LineClusterer {
    pub fn cluster_into_lines(mut blocks: Vec<TextBlock>, threshold: f32) -> Vec<Vec<TextBlock>> {
        if blocks.is_empty() {
            return Vec::new();
        }

        // Sort blocks by y coordinate
        blocks.sort_by_key(|b| b.box_rect.y);

        let mut lines: Vec<Vec<TextBlock>> = Vec::new();

        for block in blocks {
            let mut added = false;
            for line in lines.iter_mut() {
                if let Some(first) = line.first() {
                    if ((block.box_rect.y - first.box_rect.y) as f32).abs() <= threshold {
                        line.push(block.clone());
                        added = true;
                        break;
                    }
                }
            }

            if !added {
                lines.push(vec![block]);
            }
        }

        // Sort each line horizontally by x
        for line in lines.iter_mut() {
            line.sort_by_key(|b| b.box_rect.x);
        }

        lines
    }
}

pub struct WordMerger;

impl WordMerger {
    pub fn merge_line(line_blocks: Vec<TextBlock>, _gap_threshold: f32) -> TextBlock {
        if line_blocks.is_empty() {
            return TextBlock {
                text: String::new(),
                confidence: 1.0,
                box_rect: BoundingBox {
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                },
            };
        }

        let mut merged_text = String::new();
        let mut min_x = i32::MAX;
        let mut min_y = i32::MAX;
        let mut max_x = i32::MIN;
        let mut max_y = i32::MIN;
        let mut total_confidence = 0.0f32;

        for (idx, b) in line_blocks.iter().enumerate() {
            if idx > 0 {
                merged_text.push(' ');
            }
            merged_text.push_str(&b.text);
            total_confidence += b.confidence;

            min_x = min_x.min(b.box_rect.x);
            min_y = min_y.min(b.box_rect.y);
            max_x = max_x.max(b.box_rect.x + b.box_rect.width as i32);
            max_y = max_y.max(b.box_rect.y + b.box_rect.height as i32);
        }

        let avg_confidence = total_confidence / (line_blocks.len() as f32);

        TextBlock {
            text: merged_text,
            confidence: avg_confidence,
            box_rect: BoundingBox {
                x: min_x,
                y: min_y,
                width: (max_x - min_x).max(0) as u32,
                height: (max_y - min_y).max(0) as u32,
            },
        }
    }
}
