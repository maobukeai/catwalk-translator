import numpy as np

class TextReconstructor:
    def __init__(self, horizontal_gap_ratio: float = 0.8, vertical_overlap_ratio: float = 0.5):
        self.horizontal_gap_ratio = horizontal_gap_ratio
        self.vertical_overlap_ratio = vertical_overlap_ratio

    def merge_nearby_boxes(self, ocr_items: list) -> list:
        """
        输入 OCR 检测到的元素列表，格式为:
        [{'box': [[x1,y1],[x2,y2],[x3,y3],[x4,y4]], 'text': 'Base', 'score': 0.95}, ...]
        输出按几何同行关系以及水平均匀间距合并后的新元素列表
        """
        if not ocr_items:
            return []

        # 1. 为每个 item 计算包围盒统计量
        formatted_items = []
        for item in ocr_items:
            pts = np.array(item['box'], dtype=np.float32)
            min_x, min_y = np.min(pts, axis=0)
            max_x, max_y = np.max(pts, axis=0)
            height = max(max_y - min_y, 1.0)
            center_y = (min_y + max_y) / 2.0
            
            formatted_items.append({
                'box': item['box'],
                'text': item['text'].strip(),
                'score': item['score'],
                'min_x': min_x,
                'max_x': max_x,
                'min_y': min_y,
                'max_y': max_y,
                'center_y': center_y,
                'height': height
            })

        # 2. 按 center_y 大致排序
        formatted_items.sort(key=lambda x: x['center_y'])

        # 3. 按垂直行归类
        lines = []
        for item in formatted_items:
            placed = False
            for line in lines:
                avg_center_y = sum([i['center_y'] for i in line]) / len(line)
                avg_height = sum([i['height'] for i in line]) / len(line)
                if abs(item['center_y'] - avg_center_y) < avg_height * self.vertical_overlap_ratio:
                    line.append(item)
                    placed = True
                    break
            if not placed:
                lines.append([item])

        # 4. 对每一行内的框按 X 升序排序，并合并符合间距条件的词
        merged_results = []
        for line in lines:
            line.sort(key=lambda x: x['min_x'])
            
            curr_group = None
            for item in line:
                if curr_group is None:
                    curr_group = {
                        'boxes': [item['box']],
                        'text_parts': [item['text']],
                        'scores': [item['score']],
                        'min_x': item['min_x'],
                        'max_x': item['max_x'],
                        'min_y': item['min_y'],
                        'max_y': item['max_y'],
                        'avg_height': item['height']
                    }
                else:
                    gap_x = item['min_x'] - curr_group['max_x']
                    allowable_gap = curr_group['avg_height'] * self.horizontal_gap_ratio
                    
                    if gap_x <= allowable_gap:
                        # 融合进当前组
                        curr_group['boxes'].append(item['box'])
                        curr_group['text_parts'].append(item['text'])
                        curr_group['scores'].append(item['score'])
                        curr_group['max_x'] = max(curr_group['max_x'], item['max_x'])
                        curr_group['min_y'] = min(curr_group['min_y'], item['min_y'])
                        curr_group['max_y'] = max(curr_group['max_y'], item['max_y'])
                        curr_group['avg_height'] = (curr_group['avg_height'] + item['height']) / 2.0
                    else:
                        # 存下前一个组，发起新组
                        merged_results.append(self._build_merged_item(curr_group))
                        curr_group = {
                            'boxes': [item['box']],
                            'text_parts': [item['text']],
                            'scores': [item['score']],
                            'min_x': item['min_x'],
                            'max_x': item['max_x'],
                            'min_y': item['min_y'],
                            'max_y': item['max_y'],
                            'avg_height': item['height']
                        }
            if curr_group:
                merged_results.append(self._build_merged_item(curr_group))

        return merged_results

    def _build_merged_item(self, group: dict) -> dict:
        merged_text = " ".join(group['text_parts'])
        # 融合 4 点外接矩形 (保持 Polygon 四点结构)
        merged_box = [
            [group['min_x'], group['min_y']],
            [group['max_x'], group['min_y']],
            [group['max_x'], group['max_y']],
            [group['min_x'], group['max_y']]
        ]
        avg_score = sum(group['scores']) / len(group['scores'])
        return {
            'box': merged_box,
            'text': merged_text,
            'score': avg_score
        }

if __name__ == "__main__":
    reconstructor = TextReconstructor()
    test_items = [
        {'box': [[10, 10], [50, 10], [50, 30], [10, 30]], 'text': 'Base', 'score': 0.98},
        {'box': [[55, 10], [100, 10], [100, 30], [55, 30]], 'text': 'Color', 'score': 0.95}
    ]
    res = reconstructor.merge_nearby_boxes(test_items)
    print("重构合并结果:", res)
