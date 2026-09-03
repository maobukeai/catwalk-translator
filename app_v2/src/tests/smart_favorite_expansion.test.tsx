import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateTranslationQuality } from '../services/smartQualityFilter';
import { useSettingsStore } from '../stores/useSettingsStore';

describe('优质生词智能甄选引擎与容量扩容测试', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings();
  });

  describe('evaluateTranslationQuality 规则判定', () => {
    it('精准识别行业专业 3D/CG 术语为优质生词', () => {
      const res1 = evaluateTranslationQuality(
        'Subsurface Scattering',
        '次表面散射',
        'Blender Preset'
      );
      expect(res1.isQuality).toBe(true);
      expect(res1.category).toBe('cg_term');

      const res2 = evaluateTranslationQuality(
        'Ambient Occlusion',
        '环境光遮蔽',
        'Preset Dictionary'
      );
      expect(res2.isQuality).toBe(true);
      expect(res2.category).toBe('cg_term');
    });

    it('精准识别 AI 深度精翻优质短语为优质生词', () => {
      const res = evaluateTranslationQuality(
        'Volumetric light scattered through clouds',
        '穿透云层弥散的体积丁达尔光',
        'Gemini AI 精翻 ✨'
      );
      expect(res.isQuality).toBe(true);
      expect(res.category).toBe('ai_refined');
    });

    it('拦截纯数字、符号、URL 与代码垃圾字符', () => {
      expect(evaluateTranslationQuality('100%', '100%', 'Online Fallback').isQuality).toBe(false);
      expect(evaluateTranslationQuality('404', '404', 'Online Fallback').isQuality).toBe(false);
      expect(evaluateTranslationQuality('https://blender.org', '链接', 'Online Fallback').isQuality).toBe(false);
      expect(evaluateTranslationQuality('->', '->', 'Online Fallback').isQuality).toBe(false);
    });

    it('拦截日常极高频操作与功能词', () => {
      expect(evaluateTranslationQuality('OK', '确定', 'Online Fallback').isQuality).toBe(false);
      expect(evaluateTranslationQuality('Cancel', '取消', 'Online Fallback').isQuality).toBe(false);
      expect(evaluateTranslationQuality('File', '文件', 'Online Fallback').isQuality).toBe(false);
      expect(evaluateTranslationQuality('Close', '关闭', 'Online Fallback').isQuality).toBe(false);
    });

    it('正确识别英文专业复合术语', () => {
      const res = evaluateTranslationQuality(
        'Roughness Map',
        '粗糙度贴图',
        'Online Fallback'
      );
      expect(res.isQuality).toBe(true);
      expect(res.category).toBe('advanced_phrase');
    });
  });

  describe('设置项 autoFavoriteQualityTerms 响应', () => {
    it('默认启用自动甄选收藏', () => {
      expect(useSettingsStore.getState().settings.autoFavoriteQualityTerms).toBe(true);
    });

    it('能够成功切换开关状态', () => {
      useSettingsStore.getState().setAutoFavoriteQualityTerms(false);
      expect(useSettingsStore.getState().settings.autoFavoriteQualityTerms).toBe(false);

      useSettingsStore.getState().setAutoFavoriteQualityTerms(true);
      expect(useSettingsStore.getState().settings.autoFavoriteQualityTerms).toBe(true);
    });
  });
});
