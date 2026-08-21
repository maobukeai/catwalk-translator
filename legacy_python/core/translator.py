import urllib.parse
import urllib.request
import json
import re
import threading
from enum import Enum

class TranslationPreset(Enum):
    BLENDER = "blender"
    SUBSTANCE = "substance"
    UNITY = "unity"
    GENERAL = "general"

class Translator:
    def __init__(self, default_preset=TranslationPreset.GENERAL):
        self.current_preset = default_preset

        # 翻译结果缓存：相同短语在本次运行中只请求一次网络
        self._cache = {}
        self._cache_lock = threading.Lock()

        # Blender 专门词库
        self.blender_dict = {
            "base color": "基础颜色",
            "roughness": "粗糙度",
            "metallic": "金属度",
            "normal": "法线",
            "normal map": "法线贴图",
            "specular": "高光",
            "subsurface": "次表面",
            "subsurface scattering": "次表面散射",
            "subsurface color": "次表面颜色",
            "subsurface radius": "次表面半径",
            "transmission": "透光度",
            "transmission roughness": "透光粗糙度",
            "emission": "自发光",
            "emission strength": "自发光强度",
            "alpha": "透明度",
            "ior": "折射率",
            "anisotropic": "各向异性",
            "anisotropic rotation": "各向异性旋转",
            "coat": "涂层",
            "coat roughness": "涂层粗糙度",
            "coat normal": "涂层法线",
            "sheen": "光泽",
            "sheen tint": "光泽色调",
            "displacement": "置换贴图",
            "bump": "凹凸",
            "geometry": "几何体",
            "attribute": "属性",
            "vector": "向量",
            "mapping": "映射",
            "texture coordinate": "纹理坐标",
            "color ramp": "渐变节点",
            "shader": "着色器",
            "principled bsdf": "原理化BSDF",
            "diffuse bsdf": "漫反射BSDF",
            "glass bsdf": "玻璃BSDF",
            "transparent bsdf": "透明BSDF",
            "modifier": "修改器",
            "subdivision surface": "细分曲面",
            "solidify": "实体化",
            "bevel": "倒角",
            "boolean": "布尔",
            "array": "数组修改器",
            "mirror": "镜像修改器"
        }

        # Substance Painter 专门词库
        self.substance_dict = {
            "base color": "基础颜色",
            "basecolor": "基础颜色",
            "roughness": "粗糙度",
            "metallic": "金属度",
            "height": "高度贴图",
            "normal": "法线贴图",
            "nrm": "法线",
            "opacity": "不透明度",
            "opac": "透明通道",
            "ambient occlusion": "环境光遮蔽",
            "ao": "环境遮蔽",
            "emissive": "自发光通道",
            "displacement": "置换通道",
            "fill layer": "填充图层",
            "paint layer": "绘制图层",
            "black mask": "黑色遮罩",
            "white mask": "白色遮罩",
            "generator": "生成器",
            "filter": "过滤器",
            "anchor point": "锚点",
            "smart material": "智能材质",
            "smart mask": "智能遮罩",
            "bake mesh maps": "烘焙网格贴图",
            "world space normals": "世界空间法线",
            "curvature": "曲率贴图",
            "position": "位置贴图",
            "thickness": "厚度贴图"
        }

        # Unity / 渲染引擎专有名词
        self.unity_dict = {
            "albedo": "漫反射/基础色",
            "smoothness": "平滑度",
            "metallicness": "金属感",
            "occlusion": "遮蔽贴图",
            "tiling": "平铺 tiling",
            "offset": "偏移 offset",
            "cull": "剔除模式",
            "zwrite": "深度写入",
            "blend": "混合模式"
        }

        # 通用与汇聚总表
        self.all_presets = {
            TranslationPreset.BLENDER: self.blender_dict,
            TranslationPreset.SUBSTANCE: self.substance_dict,
            TranslationPreset.UNITY: self.unity_dict
        }

    def set_preset(self, preset: TranslationPreset):
        self.current_preset = preset

    def translate_text(self, text: str, source_lang='auto', target_lang='auto') -> str:
        text_clean = " ".join(text.strip().split())
        if not text_clean:
            return ""

        # 智能检测中英文及多语种双向互译：包含中文则转英文，外语/英文则转中文
        has_chinese = bool(re.search(r'[\u4e00-\u9fff]', text_clean))
        eff_src = 'zh-CN' if has_chinese else 'auto'
        eff_tgt = 'en' if has_chinese else 'zh-CN'

        # 不含任何字母、中文、日韩文（纯数字/标点符号）→ 跳过
        if not re.search(r'[A-Za-z\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]', text_clean):
            return text_clean

        cache_key = f"{self.current_preset.value}|{eff_src}|{eff_tgt}|{text_clean}"
        with self._cache_lock:
            cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        result = self._translate_impl(text_clean, eff_src, eff_tgt)

        with self._cache_lock:
            self._cache[cache_key] = result
            if len(self._cache) > 2000:  # 无限增长防护
                self._cache.clear()
        return result

    def _translate_impl(self, text_clean: str, source_lang: str, target_lang: str) -> str:
        lower_text = text_clean.lower()

        # 1. 查当前指定模式 Preset 字典
        if self.current_preset in self.all_presets:
            p_dict = self.all_presets[self.current_preset]
            if lower_text in p_dict:
                return p_dict[lower_text]

        # 2. 查其他所有 CG 字典
        for p_dict in self.all_presets.values():
            if lower_text in p_dict:
                return p_dict[lower_text]

        # 3. 查不到时降级调用在线 API
        try:
            return self._translate_online_google(text_clean, source_lang, target_lang)
        except Exception:
            try:
                return self._translate_online_mymemory(text_clean, source_lang, target_lang)
            except Exception as e:
                print(f"[Translator Error] {e}")
                return text_clean

    def _translate_online_google(self, text: str, source_lang: str, target_lang: str) -> str:
        url = "https://translate.googleapis.com/translate_a/single"
        params = {
            "client": "gtx",
            "sl": source_lang,
            "tl": target_lang,
            "dt": "t",
            "q": text
        }
        query_string = urllib.parse.urlencode(params)
        full_url = f"{url}?{query_string}"
        
        req = urllib.request.Request(full_url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        })
        with urllib.request.urlopen(req, timeout=3) as response:
            data = json.loads(response.read().decode('utf-8'))
            translated_chunks = []
            if data and data[0]:
                for chunk in data[0]:
                    if chunk[0]:
                        translated_chunks.append(chunk[0])
            return "".join(translated_chunks) if translated_chunks else text

    def _translate_online_mymemory(self, text: str, source_lang: str, target_lang: str) -> str:
        url = f"https://api.mymemory.translated.net/get?q={urllib.parse.quote(text)}&langpair={source_lang}|{target_lang}"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0'
        })
        with urllib.request.urlopen(req, timeout=3) as response:
            data = json.loads(response.read().decode('utf-8'))
            return data.get('responseData', {}).get('translatedText', text)
