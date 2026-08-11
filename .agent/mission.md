# Product Mission: CG AI Screenshot Translator (app_v2)

## 1. 产品定位与使命
**CG AI Screenshot Translator** 是一款面向数字艺术与游戏开发工程师的轻量级无感屏幕划词/截图翻译工具。
> **使命宣言**："让 CG 软件（Blender / Substance 3D / Unity / Unreal Engine / Maya）界面零门槛本地化，鼠标框选即翻译，消除语言障碍，释放数字创作生产力。"

---

## 2. 目标受众 (Target Audience)
1. **3D/CG 概念设计师、建模师与渲染师**：
   - 痛点：Blender、Substance Painter/Designer、ZBrush、Maya 等软件专业术语极其晦涩，官方中文汉化不全或机械翻译破坏工作流。
2. **游戏引擎开发者与技术美术 (TA)**：
   - 痛点：Unity、Unreal Engine 材质节点、着色器属性、插件面板英文复合词众多，频繁查词打断开发心流。
3. **数字艺术院校师生与初学者**：
   - 痛点：外文 CG 教程/插件界面难以快速对照理解。

---

## 3. 核心价值与护城河 (Core Value & Moat)
1. **零延迟无感交互 (<200ms E2E)**：
   - 全局热键唤起 -> GDI 选区高速截取 -> 本地 PP-OCRv4 ONNX 毫秒级推理 -> 原位覆盖渲染。
2. **三维/CG 专属语料与精准术语库**：
   - 内置 Blender、Substance、Unity 等百万级行业精调词库，杜绝通用机翻的"望文生义"。
3. **多级智能容灾与离线能力 (Multi-Tier Resilience)**：
   - 行业词库 -> 本地离线词典 -> 云端 LLM (DeepSeek / OpenAI / Ollama) -> 免 Key 公共通道，断网依然可用。
4. **极致 Fluent / Frosted Glass 视觉美学**：
   - 沉浸式毛玻璃半透明浮层与原位文字替代表现，与专业 CG 软件暗色主题完美融合。
