import React, { useState } from 'react';
import {
  Bot, RotateCcw, Power, Trash2, Plus, Eye, EyeOff, Check,
  Star, Sparkles, Server, CheckCircle2, AlertCircle, Layers
} from 'lucide-react';
import { useLlmPanelState, PROVIDER_PRESET_MODELS } from './useLlmPanelState';
import type { AiModelItem } from '../../../services/types';

interface LlmProviderConfigCardProps {
  isLight: boolean;
}

export const LlmProviderConfigCard: React.FC<LlmProviderConfigCardProps> = ({ isLight }) => {
  const {
    providers,
    selectedProviderId,
    setSelectedProviderId,
    currentProvider,
    currentModels,
    handleUpdateCurrentProvider,
    handleAddModelToCurrentProvider,
    handleRemoveModelFromCurrent,
    handleToggleModelInCurrent,
    handleSetDefaultModelInCurrent,
    handleAddNewProvider,
    handleDeleteCurrentProvider,
    showApiKey,
    setShowApiKey,
    testLatency,
    testStatus,
    testSuccess,
    isTestingLlm,
    isFetchingModels,
    fetchedModels,
    fetchModelNotice,
    handleTestLlmConnection,
    handleFetchModels,
    handleProviderChange,
  } = useLlmPanelState();

  const [newModelId, setNewModelId] = useState('');
  const [newModelDisplayName, setNewModelDisplayName] = useState('');
  const [selectedRemoteModel, setSelectedRemoteModel] = useState('');
  const [showAddProviderModal, setShowAddProviderModal] = useState(false);
  const [customProvName, setCustomProvName] = useState('');
  const [customProvEndpoint, setCustomProvEndpoint] = useState('');

  // 推荐未添加的模型
  const currentModelIds = new Set(currentModels.map((m) => m.modelId));
  const presetList = PROVIDER_PRESET_MODELS[currentProvider.providerType || currentProvider.name] || [];
  const unaddedPresets = presetList.filter((m) => !currentModelIds.has(m));

  const handleManualAddModel = (e: React.FormEvent) => {
    e.preventDefault();
    const id = newModelId.trim();
    if (!id) return;
    handleAddModelToCurrentProvider(id, newModelDisplayName.trim() || undefined);
    setNewModelId('');
    setNewModelDisplayName('');
  };

  const handleAddRemoteModel = () => {
    if (!selectedRemoteModel) return;
    handleAddModelToCurrentProvider(selectedRemoteModel);
    setSelectedRemoteModel('');
  };

  const handleCreateCustomProvider = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customProvName.trim() || !customProvEndpoint.trim()) return;
    handleAddNewProvider(customProvName.trim(), customProvEndpoint.trim(), 'Custom');
    setCustomProvName('');
    setCustomProvEndpoint('');
    setShowAddProviderModal(false);
  };

  return (
    <div
      className={`p-5 space-y-5 rounded-2xl border transition-colors ${
        isLight
          ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800'
          : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
      }`}
    >
      {/* 顶部标题与全局操作 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className={`flex items-center space-x-2 text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
            <Bot className="h-4 w-4 text-indigo-500" />
            <span>AI 大语言模型服务配置 (LLM)</span>
            <span
              className={`text-[10px] font-normal px-2 py-0.5 rounded-full border ${
                isLight ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-indigo-500/15 text-indigo-300 border-indigo-400/30'
              }`}
            >
              1 供应商多模型体系
            </span>
          </div>
          <p className={`mt-1 text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
            凭据（API Key 与 Base URL）按供应商配置一次，共享给该供应商下的所有模型；各模型可独立启停与选择
          </p>
        </div>

        {/* 测试连通性与拉取模型按钮组 */}
        <div className="flex items-center gap-2 flex-nowrap shrink-0 whitespace-nowrap">
          <button
            type="button"
            onClick={handleFetchModels}
            disabled={isFetchingModels || !currentProvider.endpoint}
            className={`rounded-xl border px-3.5 py-1.5 text-xs font-medium disabled:opacity-40 transition flex items-center gap-1.5 cursor-pointer ${
              isLight
                ? 'bg-slate-100 border-slate-300 text-blue-700 hover:bg-slate-200'
                : 'bg-zinc-800/90 border-white/10 text-blue-300 hover:bg-zinc-700 hover:text-white'
            }`}
            title="向当前供应商的 endpoint/models 发起 GET 请求拉取所有可用模型"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isFetchingModels ? 'animate-spin' : ''}`} />
            <span>{isFetchingModels ? '拉取模型中...' : '拉取所有可用模型'}</span>
          </button>

          <button
            type="button"
            onClick={handleTestLlmConnection}
            disabled={isTestingLlm}
            className={`rounded-xl border px-3.5 py-1.5 text-xs font-medium disabled:opacity-40 transition flex items-center gap-1.5 cursor-pointer ${
              isLight
                ? 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200'
                : 'bg-zinc-800/90 border-white/[0.08] text-zinc-200 hover:bg-zinc-700 hover:text-white'
            }`}
          >
            <span>{isTestingLlm ? '测试中...' : '测试连通性'}</span>
            {testLatency !== null && testSuccess && (
              <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/20 border border-emerald-400/30 px-1.5 py-0.2 rounded-full">
                {testLatency}ms
              </span>
            )}
            {testSuccess === false && (
              <span className="text-[10px] font-mono font-bold text-rose-400 bg-rose-500/20 border border-rose-400/30 px-1.5 py-0.2 rounded-full">
                失败
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 测试状态通知栏 */}
      {(testStatus || fetchModelNotice) && (
        <div
          className={`px-3 py-2 rounded-xl text-xs font-mono flex items-center gap-2 border ${
            testSuccess === false || (fetchModelNotice && fetchModelNotice.includes('失败'))
              ? isLight
                ? 'bg-rose-50 border-rose-200 text-rose-700'
                : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
              : isLight
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
          }`}
        >
          {testSuccess === false || (fetchModelNotice && fetchModelNotice.includes('失败')) ? (
            <AlertCircle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate">{fetchModelNotice || testStatus}</span>
        </div>
      )}

      {/* 供应商选择导航条 (水平卡片切换) */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
          <div className="flex items-center gap-2">
            <span className={isLight ? 'text-slate-800' : 'text-zinc-200'}>选择服务提供商 (Provider)</span>
            <select
              aria-label="服务提供商"
              data-testid="provider-select"
              value={currentProvider.providerType || currentProvider.name}
              onChange={handleProviderChange}
              className={`px-2 py-0.5 rounded-lg border text-xs font-medium cursor-pointer transition ${
                isLight
                  ? 'bg-white border-slate-300 text-slate-700 hover:border-blue-400'
                  : 'bg-zinc-800 border-white/10 text-zinc-200 hover:border-white/20'
              }`}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.providerType || p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setShowAddProviderModal(!showAddProviderModal)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer border ${
              isLight
                ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                : 'bg-blue-500/10 border-blue-400/30 text-blue-300 hover:bg-blue-500/20'
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>添加自定义供应商</span>
          </button>
        </div>

        {/* 自定义供应商添加表单 (展开状态) */}
        {showAddProviderModal && (
          <form
            onSubmit={handleCreateCustomProvider}
            className={`p-3 rounded-xl border flex flex-wrap items-center gap-2 text-xs ${
              isLight ? 'bg-slate-50 border-slate-300' : 'bg-zinc-950/90 border-white/10'
            }`}
          >
            <input
              type="text"
              value={customProvName}
              onChange={(e) => setCustomProvName(e.target.value)}
              placeholder="供应商名称 (如: 我的企业网关)"
              required
              className={`px-3 py-1.5 rounded-lg border text-xs flex-1 min-w-[140px] ${
                isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-900 border-zinc-700 text-zinc-100'
              }`}
            />
            <input
              type="text"
              value={customProvEndpoint}
              onChange={(e) => setCustomProvEndpoint(e.target.value)}
              placeholder="API 接口地址 (如: https://api.my-gateway.com/v1)"
              required
              className={`px-3 py-1.5 rounded-lg border text-xs flex-1 min-w-[220px] font-mono ${
                isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-900 border-zinc-700 text-zinc-100'
              }`}
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs cursor-pointer shadow-xs"
            >
              确认添加
            </button>
            <button
              type="button"
              onClick={() => setShowAddProviderModal(false)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer ${
                isLight ? 'bg-white border-slate-200 text-slate-600' : 'bg-zinc-800 border-zinc-700 text-zinc-300'
              }`}
            >
              取消
            </button>
          </form>
        )}

        {/* 供应商水平选项卡网格 */}
        <div className="flex flex-wrap gap-2">
          {providers.map((p) => {
            const isSelected = p.id === selectedProviderId;
            const modelCount = p.models?.length || 0;
            const enabledCount = p.models?.filter((m) => m.enabled).length || 0;
            const isConfigured = !!p.apiKey || p.endpoint?.includes('localhost') || p.endpoint?.includes('127.0.0.1');

            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedProviderId(p.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition cursor-pointer select-none ${
                  isSelected
                    ? isLight
                      ? 'bg-blue-600 text-white border-blue-500 shadow-md ring-2 ring-blue-500/20'
                      : 'bg-blue-600 text-white border-blue-400 shadow-md ring-2 ring-blue-500/30'
                    : isLight
                      ? 'bg-white text-slate-700 border-slate-200/90 hover:border-blue-300 hover:bg-blue-50/50'
                      : 'bg-zinc-900/80 text-zinc-300 border-white/[0.08] hover:border-white/20 hover:bg-zinc-800'
                }`}
              >
                {/* 状态指示圆点 */}
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    !p.enabled
                      ? 'bg-zinc-400'
                      : isConfigured
                        ? isSelected
                          ? 'bg-emerald-300'
                          : 'bg-emerald-500'
                        : isSelected
                          ? 'bg-amber-300'
                          : 'bg-amber-500'
                  }`}
                  title={
                    !p.enabled
                      ? '已停用'
                      : isConfigured
                        ? '凭据已就绪'
                        : '未填写 API Key'
                  }
                />

                <span className="font-semibold">{p.name}</span>

                {/* 绑定的模型数量角标 */}
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full border ${
                    isSelected
                      ? 'bg-white/20 border-white/30 text-white'
                      : isLight
                        ? 'bg-slate-100 border-slate-200 text-slate-600'
                        : 'bg-zinc-800 border-white/10 text-zinc-400'
                  }`}
                  title={`共 ${modelCount} 个模型，其中 ${enabledCount} 个启用`}
                >
                  {modelCount} 模型
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 当前选中供应商的详情卡片 */}
      <div
        className={`rounded-2xl border p-4 sm:p-5 space-y-4 ${
          isLight ? 'bg-slate-50/90 border-slate-200' : 'bg-zinc-950/60 border-white/[0.08]'
        }`}
      >
        {/* 供应商凭据与启停头部 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3.5 border-dashed border-slate-200 dark:border-white/10">
          <div className="flex items-center space-x-2">
            <Server className="h-4 w-4 text-blue-500" />
            <span className={`text-sm font-bold ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>
              {currentProvider.name} 基础配置
            </span>
            <span
              className={`text-[10px] font-mono px-2 py-0.2 rounded-full border ${
                currentProvider.enabled
                  ? isLight
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                  : isLight
                    ? 'bg-slate-200 text-slate-600 border-slate-300'
                    : 'bg-zinc-800 text-zinc-400 border-white/10'
              }`}
            >
              {currentProvider.enabled ? '供应商已开启' : '供应商已停用'}
            </span>
          </div>

          <div className="flex items-center space-x-3">
            {/* 启用/停用供应商开关 */}
            <div className="flex items-center space-x-2">
              <span className={`text-xs ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>
                {currentProvider.enabled ? '已启用' : '已停用'}
              </span>
              <button
                type="button"
                onClick={() => handleUpdateCurrentProvider({ enabled: !currentProvider.enabled })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ${
                  currentProvider.enabled ? 'bg-blue-600' : isLight ? 'bg-slate-300' : 'bg-zinc-700'
                }`}
                title={currentProvider.enabled ? '停用此供应商及其全部模型' : '启用此供应商'}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    currentProvider.enabled ? 'translate-x-4.5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* 若为自定义供应商，支持删除 */}
            {providers.length > 1 && (currentProvider.providerType === 'Custom' || currentProvider.id.startsWith('provider-custom')) && (
              <button
                type="button"
                onClick={handleDeleteCurrentProvider}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-rose-500 hover:bg-rose-500/10 text-xs transition cursor-pointer"
                title="删除该自定义供应商"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>删除供应商</span>
              </button>
            )}
          </div>
        </div>

        {/* 凭据表单 (Base URL + API Key) */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Base URL */}
          <div>
            <label className={`mb-1.5 block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
              API 接口地址 (Base URL)
            </label>
            <input
              type="text"
              value={currentProvider.endpoint}
              onChange={(e) => handleUpdateCurrentProvider({ endpoint: e.target.value })}
              placeholder="https://api.example.com/v1"
              className={`w-full rounded-xl border px-3.5 py-2 text-xs focus:border-blue-500 focus:outline-none font-mono ${
                isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-900 border-white/[0.09] text-zinc-100'
              }`}
            />
            <p className={`mt-1 text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
              标准 OpenAI 兼容路径（以 /v1 或 /v2 结尾）
            </p>
          </div>

          {/* API Key */}
          <div>
            <label className={`mb-1.5 block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
              API 密钥 (API Key)
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={currentProvider.apiKey}
                onChange={(e) => handleUpdateCurrentProvider({ apiKey: e.target.value })}
                placeholder={currentProvider.endpoint?.includes('localhost') ? '本地服务无需填密钥（可选）' : 'sk-...'}
                className={`w-full rounded-xl border px-3.5 py-2 pr-10 text-xs focus:border-blue-500 focus:outline-none font-mono ${
                  isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-900 border-white/[0.09] text-zinc-100'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className={`absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer ${
                  isLight ? 'text-slate-400 hover:text-slate-700' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className={`mt-1 text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
              密钥在此配置一次，该供应商下的所有模型自动共享
            </p>
          </div>
        </div>

        {/* 绑定的模型列表与管理 */}
        <div
          className={`p-4 rounded-xl border space-y-3 ${
            isLight ? 'bg-white/80 border-slate-200' : 'bg-zinc-900/60 border-white/5'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className={`flex items-center space-x-1.5 text-xs font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                <Layers className="h-3.5 w-3.5 text-blue-500" />
                <span>已挂载模型 ({currentModels.length} 个)</span>
              </div>
              <p className={`text-[10px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                点击卡片可设为默认模型，点击开关可停用/启用单模型
              </p>
            </div>

            {/* 快速从云端拉取的模型中添加 */}
            {fetchedModels.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs">
                <select
                  value={selectedRemoteModel}
                  onChange={(e) => setSelectedRemoteModel(e.target.value)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-mono max-w-[180px] truncate ${
                    isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-900 border-zinc-700 text-zinc-100'
                  }`}
                >
                  <option value="">-- 选择已识别的云端模型 --</option>
                  {fetchedModels
                    .filter((m) => !currentModelIds.has(m))
                    .map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddRemoteModel}
                  disabled={!selectedRemoteModel}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium cursor-pointer"
                >
                  + 挂载
                </button>
              </div>
            )}
          </div>

          {/* 模型卡片网格 */}
          <div className="flex flex-wrap gap-2">
            {currentModels.map((m) => {
              const isDefault = currentProvider.defaultModelId === m.modelId;
              const isModelEnabled = m.enabled;

              return (
                <div
                  key={m.id || m.modelId}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSetDefaultModelInCurrent(m.modelId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSetDefaultModelInCurrent(m.modelId);
                  }}
                  className={`group flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-xl border text-xs transition cursor-pointer select-none ${
                    !isModelEnabled
                      ? isLight
                        ? 'bg-slate-100/90 text-slate-400 border-slate-200 opacity-60 hover:opacity-100'
                        : 'bg-zinc-900/40 text-zinc-500 border-white/5 opacity-50 hover:opacity-90'
                      : isDefault
                        ? isLight
                          ? 'bg-blue-50 border-blue-400 text-blue-800 shadow-xs ring-1 ring-blue-400/40'
                          : 'bg-blue-500/15 border-blue-400/50 text-blue-200 shadow-xs ring-1 ring-blue-400/30'
                        : isLight
                          ? 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'
                          : 'bg-zinc-800/80 text-zinc-300 border-white/10 hover:border-white/20'
                  }`}
                  title={isDefault ? '当前为该供应商默认模型' : '点击设为默认模型'}
                >
                  {isDefault && (
                    <span className="flex items-center text-amber-500" title="默认模型">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                    </span>
                  )}

                  <div className="flex flex-col min-w-0 pr-1">
                    <span
                      className={`font-semibold max-w-[170px] truncate ${
                        !isModelEnabled ? 'line-through' : isLight ? 'text-slate-800' : 'text-zinc-100'
                      }`}
                    >
                      {m.displayName || m.modelId}
                    </span>
                    {m.displayName && m.displayName !== m.modelId && (
                      <span className="font-mono text-[9px] text-zinc-400 truncate max-w-[170px]">
                        {m.modelId}
                      </span>
                    )}
                  </div>

                  {!isModelEnabled && (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-500">
                      已停用
                    </span>
                  )}

                  {/* 模型启停开关 */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleModelInCurrent(m.modelId);
                    }}
                    className={`p-1 rounded-lg transition cursor-pointer ${
                      isModelEnabled
                        ? isLight
                          ? 'hover:bg-emerald-50 text-emerald-600'
                          : 'hover:bg-emerald-500/20 text-emerald-400'
                        : isLight
                          ? 'hover:bg-slate-200 text-slate-400 hover:text-slate-700'
                          : 'hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200'
                    }`}
                    title={isModelEnabled ? '点击停用该模型' : '点击启用该模型'}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </button>

                  {/* 删除模型按钮 (保留至少 1 个) */}
                  {currentModels.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveModelFromCurrent(m.modelId);
                      }}
                      className="p-1 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                      title="从该供应商移除此模型"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* 推荐预设模型一键挂载 */}
          {unaddedPresets.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
              <span className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>推荐预设:</span>
              {unaddedPresets.map((presetModel) => (
                <button
                  key={presetModel}
                  type="button"
                  onClick={() => handleAddModelToCurrentProvider(presetModel)}
                  className={`px-2 py-0.5 rounded-lg border text-[10px] font-mono transition cursor-pointer ${
                    isLight
                      ? 'bg-slate-50 border-slate-200 text-blue-700 hover:bg-blue-50'
                      : 'bg-zinc-800/60 border-white/10 text-blue-300 hover:bg-zinc-800'
                  }`}
                >
                  + {presetModel}
                </button>
              ))}
            </div>
          )}

          {/* 手动添加新模型输入行 */}
          <form onSubmit={handleManualAddModel} className="flex flex-wrap items-center gap-2 pt-2 text-xs border-t border-dashed border-slate-200 dark:border-white/5">
            <input
              type="text"
              value={newModelId}
              onChange={(e) => setNewModelId(e.target.value)}
              placeholder="输入 Model ID (如: deepseek-chat, gpt-4o)"
              required
              className={`px-3 py-1.5 rounded-xl border text-xs font-mono flex-1 min-w-[160px] ${
                isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-900 border-white/10 text-zinc-100'
              }`}
            />
            <input
              type="text"
              value={newModelDisplayName}
              onChange={(e) => setNewModelDisplayName(e.target.value)}
              placeholder="显示别名 (可选，如: 极速版)"
              className={`px-3 py-1.5 rounded-xl border text-xs flex-1 min-w-[140px] ${
                isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-900 border-white/10 text-zinc-100'
              }`}
            />
            <button
              type="submit"
              className="flex items-center gap-1 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs cursor-pointer shadow-xs whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>添加模型到供应商</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
