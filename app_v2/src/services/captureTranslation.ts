import { cmdUniversalTranslate } from './tauri';
import type { AppSettings, LanguageCode, TranslationResult } from './types';

/** All capture entry points use the same selected online engine and credentials. */
export async function translateCaptureOnline(
  text: string,
  engine: string,
  targetLang: LanguageCode,
  preset: string,
  settings: AppSettings,
): Promise<TranslationResult> {
  const response = await cmdUniversalTranslate({
    text, sourceLang: 'auto', targetLang, preset, forcedEngine: engine,
    llmConfig: null,
    presetDicts: settings.presetDicts,
    onlineEngines: settings.onlineEngines,
    translationTiers: settings.translationTiers,
    style: settings.translationStyle,
    baiduAppId: settings.baiduAppId,
    baiduSecret: settings.baiduSecret,
    baiduLlmApiKey: settings.baiduLlmApiKey,
    deeplApiKey: settings.deeplApiKey,
    deeplCustomUrl: settings.deeplCustomUrl,
    volcengineAccessKey: settings.volcengineAccessKey,
    volcengineSecretKey: settings.volcengineSecretKey,
    yandexApiKey: settings.yandexApiKey,
    yandexFolderId: settings.yandexFolderId,
  });
  const source = response.engines?.find((entry) => entry.translated === response.mainTranslation);
  return {
    original: text,
    translated: response.mainTranslation || '',
    sourceTier: source?.sourceTier || (response.mainTranslation ? engine : '翻译失败·点击重试'),
  };
}
