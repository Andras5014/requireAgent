import OpenAI from 'openai';
import config from '../config';
import type { LLMProvider, AgentConfig } from '@requireagent/shared';

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// API 类型
export type APIType = 'chat_completions' | 'responses';

interface ChatOptions {
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  apiType?: APIType;  // 默认 chat_completions
  stream?: boolean;   // 是否流式输出
}

// OpenAI 客户端
const openaiClient = config.llm.openai.apiKey 
  ? new OpenAI({
      apiKey: config.llm.openai.apiKey,
      baseURL: config.llm.openai.baseUrl,
    })
  : null;

// DeepSeek 客户端 (兼容 OpenAI API)
const deepseekClient = config.llm.deepseek.apiKey
  ? new OpenAI({
      apiKey: config.llm.deepseek.apiKey,
      baseURL: config.llm.deepseek.baseUrl,
    })
  : null;

// Claude 客户端 (使用 OpenAI 兼容层或直接调用)
const claudeClient = config.llm.claude.apiKey
  ? new OpenAI({
      apiKey: config.llm.claude.apiKey,
      baseURL: 'https://api.anthropic.com/v1',
    })
  : null;

// 本地模型客户端 (如 Ollama)
const localClient = new OpenAI({
  apiKey: 'ollama',
  baseURL: `${config.llm.local.baseUrl}/v1`,
});

// 自定义中转 API 客户端
const customClient = config.llm.custom.apiKey && config.llm.custom.baseUrl
  ? new OpenAI({
      apiKey: config.llm.custom.apiKey,
      baseURL: config.llm.custom.baseUrl,
    })
  : null;

function getClient(provider: LLMProvider): OpenAI | null {
  switch (provider) {
    case 'openai':
      return openaiClient;
    case 'deepseek':
      return deepseekClient;
    case 'claude':
      return claudeClient;
    case 'local':
      return localClient;
    case 'custom':
      return customClient;
    default:
      return openaiClient;
  }
}

function getModel(provider: LLMProvider): string {
  switch (provider) {
    case 'openai':
      return config.llm.openai.model;
    case 'deepseek':
      return config.llm.deepseek.model;
    case 'claude':
      return config.llm.claude.model;
    case 'local':
      return config.llm.local.model;
    case 'custom':
      return config.llm.custom.model;
    default:
      return config.llm.openai.model;
  }
}

export async function chat(
  messages: LLMMessage[],
  options?: ChatOptions
): Promise<LLMResponse> {
  const provider = options?.provider || config.llm.defaultProvider;
  const client = getClient(provider);
  
  if (!client) {
    throw new Error(`LLM provider ${provider} 未配置`);
  }
  
  const model = options?.model || getModel(provider);
  // 使用配置中的 apiType 作为默认值
  const apiType = options?.apiType || config.llm.apiType || 'chat_completions';
  
  try {
    // 使用 OpenAI Responses API
    if (apiType === 'responses') {
      console.log(`调用 LLM (Responses API): provider=${provider}, model=${model}`);
      return await chatWithResponsesAPI(client, model, messages, options);
    }
    
    // 默认使用 Chat Completions API
    console.log(`调用 LLM (Chat Completions): provider=${provider}, model=${model}`);
    
    let response: unknown;
    try {
      response = await client.chat.completions.create({
        model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2000,
      });
    } catch (apiError: unknown) {
      // 检查是否是 HTML 响应（通常表示 API 配置错误）
      const errorStr = String(apiError);
      if (errorStr.includes('<!DOCTYPE') || errorStr.includes('<html')) {
        throw new Error(`API 返回了 HTML 页面而不是 JSON，请检查 CUSTOM_BASE_URL 配置是否正确（应该是 API 端点地址，如 https://api.example.com/v1）`);
      }
      throw apiError;
    }
    
    // 调试日志
    const responseStr = JSON.stringify(response, null, 2);
    console.log('LLM 响应:', responseStr.slice(0, 500));
    
    // 检查是否返回了 HTML（某些代理服务在错误时会返回 HTML）
    if (typeof response === 'string') {
      if (response.includes('<!DOCTYPE') || response.includes('<html')) {
        throw new Error(`API 返回了 HTML 页面而不是 JSON，请检查 CUSTOM_BASE_URL 配置是否正确`);
      }
    }
    
    // 检查响应格式
    if (!response) {
      throw new Error('LLM 返回空响应');
    }
    
    // 类型断言为合适的类型
    const resp = response as {
      choices?: Array<{ message?: { content?: string } }>;
      output?: string;
      content?: string;
      text?: string;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };
    
    // 兼容不同的响应格式
    let content = '';
    
    if (resp.choices && resp.choices.length > 0) {
      // 标准 OpenAI 格式
      content = resp.choices[0]?.message?.content || '';
    } else if (resp.output) {
      // 某些中转 API 可能使用 output 字段
      content = resp.output;
    } else if (resp.content) {
      // 直接返回 content 字段
      content = resp.content;
    } else if (resp.text) {
      // 某些 API 使用 text 字段
      content = resp.text;
    }
    
    if (!content) {
      console.error('无法从响应中提取内容:', response);
      throw new Error(`LLM 响应格式无法识别。请检查 API 配置是否正确。响应预览: ${responseStr.slice(0, 200)}`);
    }
    
    return {
      content,
      usage: resp.usage ? {
        promptTokens: resp.usage.prompt_tokens,
        completionTokens: resp.usage.completion_tokens,
        totalTokens: resp.usage.total_tokens,
      } : undefined,
    };
  } catch (error) {
    console.error(`LLM 调用失败 (${provider}):`, error);
    throw error;
  }
}

/**
 * 使用 OpenAI Responses API (新版 API)
 * 支持 Codex 等特殊 API 格式
 * 注意：Responses API 通常返回 SSE 流式格式
 */
async function chatWithResponsesAPI(
  client: OpenAI,
  model: string,
  messages: LLMMessage[],
  options?: ChatOptions
): Promise<LLMResponse> {
  // 将消息格式转换为 Responses API 的正确格式
  // 格式: { role: "user", content: [{ type: "input_text", text: "..." }] }
  const input = messages.map(msg => {
    // system 消息也转成 user 消息（某些 API 不支持 system role）
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    return {
      role: role as 'user' | 'assistant',
      content: [
        {
          type: msg.role === 'assistant' ? 'output_text' : 'input_text',
          text: msg.role === 'system' ? `[System]: ${msg.content}` : msg.content
        }
      ]
    };
  });

  try {
    // 调用 Responses API
    let baseURL = (client as unknown as { baseURL: string }).baseURL || 'https://api.openai.com/v1';
    const apiKey = (client as unknown as { apiKey: string }).apiKey;
    
    // 移除末尾的 /v1，因为我们会添加 /v1/responses
    baseURL = baseURL.replace(/\/v1\/?$/, '');
    
    const url = `${baseURL}/v1/responses`;
    console.log(`调用 Responses API: ${url}`);
    console.log('请求 payload:', JSON.stringify({ model, input: input.slice(0, 2) }, null, 2).slice(0, 500));
    
    const useStream = options?.stream ?? true;  // 默认使用流式（因为 Responses API 通常返回 SSE）
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        model,
        input,
        store: false,
        stream: useStream,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Responses API 返回错误 ${response.status}: ${errorText.slice(0, 500)}`);
    }

    // 检查是否为 SSE 流式响应
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') || useStream) {
      // 解析 SSE 流式响应
      return await parseSSEResponse(response);
    }

    // 非流式 JSON 响应
    const responseText = await response.text();
    console.log('Responses API 原始响应:', responseText.slice(0, 500));
    
    // 检查是否返回了 HTML
    if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
      throw new Error(`API 返回了 HTML 页面，请检查 API 配置。响应: ${responseText.slice(0, 200)}`);
    }

    // 解析 JSON 响应
    let data: unknown;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(`无法解析 API 响应为 JSON: ${responseText.slice(0, 200)}`);
    }
    
    // 解析不同可能的响应格式
    const resp = data as {
      output?: Array<{ content?: Array<{ text?: string }> }>;
      choices?: Array<{ message?: { content?: string } }>;
      content?: string;
      text?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        prompt_tokens?: number;
        completion_tokens?: number;
      };
    };
    
    let outputText = '';
    
    // 尝试多种格式解析
    if (resp.output && resp.output[0]?.content?.[0]?.text) {
      // Responses API 格式
      outputText = resp.output[0].content[0].text;
    } else if (resp.choices && resp.choices[0]?.message?.content) {
      // Chat Completions 格式
      outputText = resp.choices[0].message.content;
    } else if (resp.content) {
      outputText = resp.content;
    } else if (resp.text) {
      outputText = resp.text;
    }
    
    if (!outputText) {
      console.error('无法从 Responses API 响应中提取内容:', data);
      throw new Error(`Responses API 响应格式无法识别: ${JSON.stringify(data).slice(0, 300)}`);
    }
    
    return {
      content: outputText,
      usage: resp.usage ? {
        promptTokens: resp.usage.input_tokens || resp.usage.prompt_tokens || 0,
        completionTokens: resp.usage.output_tokens || resp.usage.completion_tokens || 0,
        totalTokens: resp.usage.total_tokens || 0,
      } : undefined,
    };
  } catch (error) {
    console.error('Responses API 调用失败:', error);
    throw error;
  }
}

/**
 * 解析 SSE 流式响应
 * 处理 Responses API 的 SSE 事件格式
 */
async function parseSSEResponse(response: Response): Promise<LLMResponse> {
  const responseText = await response.text();
  console.log('SSE 响应预览:', responseText.slice(0, 800));
  
  let fullContent = '';
  let usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | undefined;
  
  const lines = responseText.split('\n');
  
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    
    const data = line.slice(6).trim();
    if (data === '[DONE]' || !data) continue;
    
    try {
      const parsed = JSON.parse(data);
      
      // 处理不同类型的 SSE 事件
      if (parsed.type === 'response.output_text.delta') {
        // 增量文本内容
        const delta = parsed.delta || '';
        fullContent += delta;
      } else if (parsed.type === 'response.output_text.done') {
        // 完成的文本内容（优先使用完整文本）
        if (parsed.text) {
          fullContent = parsed.text;
        }
      } else if (parsed.type === 'response.completed') {
        // 响应完成，提取 usage
        if (parsed.response?.usage) {
          const u = parsed.response.usage;
          usage = {
            promptTokens: u.input_tokens || u.prompt_tokens || 0,
            completionTokens: u.output_tokens || u.completion_tokens || 0,
            totalTokens: u.total_tokens || 0,
          };
        }
      } else if (parsed.delta?.content) {
        // 通用增量格式
        fullContent += parsed.delta.content;
      } else if (parsed.delta?.text) {
        // 另一种增量格式
        fullContent += parsed.delta.text;
      }
    } catch {
      // 忽略无法解析的行
    }
  }
  
  if (!fullContent) {
    throw new Error(`无法从 SSE 响应中提取内容。响应: ${responseText.slice(0, 500)}`);
  }
  
  console.log('SSE 解析结果:', fullContent.slice(0, 200));
  
  return {
    content: fullContent,
    usage,
  };
}

/**
 * 使用流式 Responses API（用于实时输出）
 */
async function chatWithResponsesAPIStream(
  client: OpenAI,
  model: string,
  messages: LLMMessage[],
  onChunk: (text: string) => void,
  _options?: ChatOptions
): Promise<LLMResponse> {
  // 转换消息格式
  const input = messages.map(msg => {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    return {
      role: role as 'user' | 'assistant',
      content: [
        {
          type: msg.role === 'assistant' ? 'output_text' : 'input_text',
          text: msg.role === 'system' ? `[System]: ${msg.content}` : msg.content
        }
      ]
    };
  });

  let baseURL = (client as unknown as { baseURL: string }).baseURL || 'https://api.openai.com/v1';
  const apiKey = (client as unknown as { apiKey: string }).apiKey;
  
  // 移除末尾的 /v1
  baseURL = baseURL.replace(/\/v1\/?$/, '');
  
  const url = `${baseURL}/v1/responses`;
  console.log(`调用 Responses API (流式): ${url}`);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: JSON.stringify({
      model,
      input,
      store: false,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Responses API 流式调用失败 ${response.status}: ${errorText.slice(0, 500)}`);
  }

  let fullContent = '';
  let usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | undefined;
  
  const reader = response.body?.getReader();
  
  if (!reader) {
    throw new Error('无法获取响应流');
  }

  const decoder = new TextDecoder();
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        
        const data = line.slice(6).trim();
        if (data === '[DONE]' || !data) continue;
        
        try {
          const parsed = JSON.parse(data);
          
          // 处理不同类型的 SSE 事件
          if (parsed.type === 'response.output_text.delta') {
            const delta = parsed.delta || '';
            if (delta) {
              fullContent += delta;
              onChunk(delta);
            }
          } else if (parsed.type === 'response.completed') {
            if (parsed.response?.usage) {
              const u = parsed.response.usage;
              usage = {
                promptTokens: u.input_tokens || u.prompt_tokens || 0,
                completionTokens: u.output_tokens || u.completion_tokens || 0,
                totalTokens: u.total_tokens || 0,
              };
            }
          } else if (parsed.delta?.content) {
            const text = parsed.delta.content;
            fullContent += text;
            onChunk(text);
          } else if (parsed.delta?.text) {
            const text = parsed.delta.text;
            fullContent += text;
            onChunk(text);
          }
        } catch {
          // 忽略解析错误，可能是不完整的 JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    content: fullContent,
    usage,
  };
}

// 保留原来的回退逻辑作为备用
async function chatWithChatCompletionsFallback(
  client: OpenAI,
  model: string,
  messages: LLMMessage[],
  options?: ChatOptions
): Promise<LLMResponse> {
  const fallbackResponse = await client.chat.completions.create({
    model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 2000,
  });
  
  return {
    content: fallbackResponse.choices[0]?.message?.content || '',
    usage: fallbackResponse.usage ? {
      promptTokens: fallbackResponse.usage.prompt_tokens,
      completionTokens: fallbackResponse.usage.completion_tokens,
      totalTokens: fallbackResponse.usage.total_tokens,
    } : undefined,
  };
}

/**
 * 流式聊天 - 支持实时返回内容
 */
export async function chatStream(
  messages: LLMMessage[],
  options?: ChatOptions,
  onChunk?: (chunk: string) => void
): Promise<LLMResponse> {
  const provider = options?.provider || config.llm.defaultProvider;
  const client = getClient(provider);
  
  if (!client) {
    throw new Error(`LLM provider ${provider} 未配置`);
  }
  
  const model = options?.model || getModel(provider);
  const apiType = options?.apiType || config.llm.apiType || 'chat_completions';
  
  try {
    // 使用 Responses API 流式调用
    if (apiType === 'responses') {
      console.log(`使用 Responses API 流式调用: provider=${provider}, model=${model}`);
      return await chatWithResponsesAPIStream(
        client, 
        model, 
        messages, 
        onChunk || (() => {}),
        options
      );
    }
    
    // 默认使用 Chat Completions API
    console.log(`使用 Chat Completions 流式调用: provider=${provider}, model=${model}`);
    const stream = await client.chat.completions.create({
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2000,
      stream: true,
    });
    
    let fullContent = '';
    let usage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullContent += content;
        onChunk?.(content);
      }
      
      // 最后一个 chunk 可能包含 usage 信息
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        };
      }
    }
    
    return {
      content: fullContent,
      usage: usage.totalTokens > 0 ? usage : undefined,
    };
  } catch (error) {
    console.error(`LLM 流式调用失败 (${provider}):`, error);
    throw error;
  }
}

export async function chatWithAgent(
  agentConfig: AgentConfig,
  messages: LLMMessage[]
): Promise<LLMResponse> {
  const systemMessage: LLMMessage = {
    role: 'system',
    content: agentConfig.systemPrompt || getDefaultSystemPrompt(agentConfig.role),
  };
  
  return chat([systemMessage, ...messages], {
    provider: agentConfig.provider,
    model: agentConfig.model,
    temperature: agentConfig.temperature,
    maxTokens: agentConfig.maxTokens,
  });
}

function getDefaultSystemPrompt(role: string): string {
  const prompts: Record<string, string> = {
    general: `你是 RequireAgent，一个专业的需求分析助手。你的职责是：
1. 帮助团队收集和整理需求
2. 发现需求中的模糊点并主动提问澄清
3. 识别需求之间的冲突或依赖关系
4. 提供专业的建议和最佳实践
5. 帮助生成规范的需求文档

请用专业但友好的语气与用户交流，确保收集到完整、清晰的需求信息。`,
    
    product: `你是产品经理 Agent，专注于：
1. 从用户需求中提取产品功能点
2. 分析用户场景和用户故事
3. 定义产品优先级和版本规划
4. 编写产品需求文档 (PRD)
5. 评估需求的商业价值`,
    
    technical: `你是技术架构师 Agent，专注于：
1. 评估需求的技术可行性
2. 设计系统架构方案
3. 识别技术风险和难点
4. 提供技术选型建议
5. 编写技术设计文档`,
    
    operation: `你是运营专家 Agent，专注于：
1. 分析用户增长策略
2. 设计运营活动方案
3. 评估市场和竞争情况
4. 制定推广计划
5. 编写运营相关文档`,
  };
  
  return prompts[role] || prompts.general;
}

// 内容过滤函数
export async function filterContent(
  messages: Array<{ content: string; userId?: string }>,
  filterConfig: {
    filterOffTopic: boolean;
    filterNoise: boolean;
    customKeywords: string[];
    strictness: 'low' | 'medium' | 'high';
    projectDescription: string;
  }
): Promise<Array<{ content: string; isFiltered: boolean; reason?: string }>> {
  const systemPrompt = `你是一个内容过滤助手。根据以下规则过滤聊天消息：

项目描述：${filterConfig.projectDescription}

过滤规则：
${filterConfig.filterOffTopic ? '- 过滤与项目需求无关的跑题闲聊' : ''}
${filterConfig.filterNoise ? '- 过滤无效信息，如"好的"、"收到"、"+1"、纯表情等' : ''}
${filterConfig.customKeywords.length > 0 ? `- 过滤包含以下关键词的内容: ${filterConfig.customKeywords.join(', ')}` : ''}

严格程度: ${filterConfig.strictness} (low=宽松, medium=适中, high=严格)

对于每条消息，判断是否应该被过滤。返回 JSON 数组格式：
[{"index": 0, "isFiltered": true/false, "reason": "过滤原因（如果被过滤）"}]`;

  const messagesText = messages.map((m, i) => `[${i}] ${m.content}`).join('\n');
  
  try {
    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: messagesText },
    ]);
    
    const results = JSON.parse(response.content);
    
    return messages.map((msg, i) => {
      const result = results.find((r: { index: number }) => r.index === i);
      return {
        content: msg.content,
        isFiltered: result?.isFiltered || false,
        reason: result?.reason,
      };
    });
  } catch (error) {
    console.error('内容过滤失败:', error);
    // 如果 AI 过滤失败，使用简单的关键词过滤
    return messages.map(msg => {
      const isNoise = config.filter.noiseKeywords.some(
        keyword => msg.content.trim() === keyword
      );
      return {
        content: msg.content,
        isFiltered: isNoise,
        reason: isNoise ? '无效信息' : undefined,
      };
    });
  }
}

// 文档生成结果接口
export interface DocumentGenerationResult {
  content: string;
  conflicts?: string[];  // 与现有文档的冲突点
  changes?: string[];    // 相对于现有文档的主要变更
}

// 文档类型之间的依赖关系
// key: 当前要生成的文档类型
// value: 需要重点参考的其他文档类型（按优先级排序）
const DOC_DEPENDENCIES: Record<string, { types: string[]; description: string }> = {
  prd: {
    types: [],  // PRD 是最上游的文档，不依赖其他文档
    description: '产品需求文档是其他文档的基础'
  },
  tech_design: {
    types: ['prd'],  // 技术方案需要参考 PRD
    description: '技术设计需要基于 PRD 中的功能需求'
  },
  db_design: {
    types: ['prd', 'tech_design'],  // 数据库设计需要参考 PRD 和技术方案
    description: '数据库设计需要基于 PRD 的业务实体和技术方案中的数据模型'
  },
  api_doc: {
    types: ['prd', 'tech_design', 'db_design'],  // API 文档需要参考前面所有技术文档
    description: 'API 设计需要基于功能需求、技术架构和数据库结构'
  },
  test_case: {
    types: ['prd', 'api_doc', 'db_design'],  // 测试用例需要参考需求和接口
    description: '测试用例需要覆盖 PRD 中的功能点和 API 接口'
  },
  operation: {
    types: ['prd'],  // 运营方案主要参考 PRD
    description: '运营方案需要基于产品功能和目标用户'
  },
  user_manual: {
    types: ['prd', 'api_doc'],  // 用户手册参考 PRD 和 API
    description: '用户手册需要描述产品功能的使用方式'
  },
};

// 文档类型的中文名称
const DOC_TYPE_NAMES: Record<string, string> = {
  prd: '产品需求文档',
  tech_design: '技术设计方案',
  db_design: '数据库设计文档',
  api_doc: 'API 接口文档',
  test_case: '测试用例文档',
  operation: '运营方案文档',
  user_manual: '用户手册',
};

// 文档生成函数
export async function generateDocument(
  type: string,
  projectInfo: {
    name: string;
    description: string;
  },
  messages: Array<{ content: string; type: string; tags: string[] }>,
  provider?: LLMProvider,
  existingDocuments?: Array<{ type: string; title: string; content: string; version: number }>
): Promise<DocumentGenerationResult> {
  const docPrompts: Record<string, string> = {
    prd: `你是一个专业的产品经理，请根据以下讨论内容生成产品需求文档 (PRD)。

文档应包含：
1. 项目概述
2. 目标用户
3. 核心功能列表
4. 功能详细描述
5. 非功能性需求
6. 优先级排序
7. 里程碑规划

请使用 Markdown 格式输出。`,

    tech_design: `你是一个资深技术架构师，请根据以下讨论内容生成技术设计方案。

文档应包含：
1. 技术选型
2. 系统架构图（使用文字描述）
3. 核心模块设计
4. 数据库设计
5. API 设计概要
6. 安全性考虑
7. 性能优化方案
8. 部署方案

请使用 Markdown 格式输出。`,

    api_doc: `你是一个 API 设计专家，请根据以下讨论内容生成 API 接口文档。

文档应包含：
1. API 概述
2. 认证方式
3. 接口列表
4. 每个接口的详细说明（请求方法、路径、参数、响应）
5. 错误码说明
6. 使用示例

请使用 Markdown 格式输出。`,

    db_design: `你是一个数据库设计专家，请根据以下讨论内容生成数据库设计文档。

文档应包含：
1. 数据模型概述
2. ER 图（使用文字描述）
3. 表结构设计
4. 索引设计
5. 数据关系说明
6. 数据迁移方案

请使用 Markdown 格式输出。`,

    test_case: `你是一个测试专家，请根据以下讨论内容生成测试用例文档。

文档应包含：
1. 测试范围
2. 测试策略
3. 功能测试用例
4. 边界测试用例
5. 异常测试用例
6. 性能测试要点

请使用 Markdown 格式输出。`,

    operation: `你是一个运营专家，请根据以下讨论内容生成运营方案文档。

文档应包含：
1. 目标用户分析
2. 市场定位
3. 推广策略
4. 用户增长方案
5. 运营活动计划
6. 数据指标定义
7. 风险预案

请使用 Markdown 格式输出。`,

    user_manual: `你是一个技术文档专家，请根据以下讨论内容生成用户手册。

文档应包含：
1. 产品简介
2. 快速开始
3. 功能说明
4. 常见问题
5. 故障排除

请使用 Markdown 格式输出，语言要通俗易懂。`,
  };

  let systemPrompt = docPrompts[type] || docPrompts.prd;
  
  // 获取当前文档类型的依赖关系
  const dependencies = DOC_DEPENDENCIES[type] || { types: [], description: '' };
  const currentDocName = DOC_TYPE_NAMES[type] || type;
  
  // 筛选出需要重点参考的文档（依赖文档）和同类型的历史版本
  const dependencyDocs: typeof existingDocuments = [];
  const previousVersionDoc: typeof existingDocuments = [];
  const otherDocs: typeof existingDocuments = [];
  
  if (existingDocuments && existingDocuments.length > 0) {
    for (const doc of existingDocuments) {
      if (doc.type === type) {
        previousVersionDoc.push(doc);
      } else if (dependencies.types.includes(doc.type)) {
        dependencyDocs.push(doc);
      } else {
        otherDocs.push(doc);
      }
    }
    
    // 按依赖优先级排序
    dependencyDocs.sort((a, b) => {
      const aIndex = dependencies.types.indexOf(a.type);
      const bIndex = dependencies.types.indexOf(b.type);
      return aIndex - bIndex;
    });
  }
  
  // 如果有依赖文档或历史版本，添加详细的参考指令
  if (dependencyDocs.length > 0 || previousVersionDoc.length > 0) {
    systemPrompt += `

**重要：文档关联与一致性要求**

当前生成的是【${currentDocName}】。`;

    if (dependencies.types.length > 0) {
      const depNames = dependencies.types.map(t => DOC_TYPE_NAMES[t] || t).join('、');
      systemPrompt += `
该文档依赖于以下上游文档：${depNames}。
${dependencies.description}。`;
    }

    systemPrompt += `

**必须遵守的规则：**
1. **继承上游文档的设计决策**：${dependencyDocs.length > 0 ? '必须基于上游文档中已确定的内容（如 PRD 中的功能点、技术方案中的架构设计）' : ''}
2. **保持术语一致**：使用与现有文档相同的专业术语和命名规范
3. **避免逻辑冲突**：不能与上游文档中的决策产生矛盾`;

    if (type === 'db_design') {
      systemPrompt += `
4. **数据库设计特别要求**：
   - 必须覆盖 PRD 中提到的所有业务实体
   - 如果技术方案中有数据模型设计，必须与之保持一致或进行细化
   - 表结构要能支撑 PRD 中描述的所有功能
   - 字段命名要与业务术语保持一致`;
    } else if (type === 'api_doc') {
      systemPrompt += `
4. **API 设计特别要求**：
   - API 必须覆盖 PRD 中的所有功能需求
   - 数据结构要与数据库设计保持一致
   - 接口命名要符合技术方案中的架构规范`;
    } else if (type === 'test_case') {
      systemPrompt += `
4. **测试用例特别要求**：
   - 必须覆盖 PRD 中的所有功能点
   - 测试数据要参考数据库设计中的字段约束
   - API 测试要与 API 文档中的接口定义一致`;
    }

    systemPrompt += `

**请在文档末尾添加：**
## 文档关联说明
### 依赖的上游文档
- （列出本文档参考了哪些上游文档的哪些内容）

### 相对于上一版本的变更
- （如果是更新版本，列出主要变更）

### 潜在冲突或待确认事项
- （如果发现与其他文档有冲突或不一致，必须在此明确指出）
- （如果有需要其他文档配合修改的地方，也要说明）`;
  }
  
  const messagesText = messages
    .filter(m => !m.type || m.type === 'user' || m.type === 'agent')
    .map(m => {
      const tags = m.tags?.length ? `[${m.tags.join(', ')}]` : '';
      return `${tags} ${m.content}`;
    })
    .join('\n\n');

  let userPrompt = `项目名称：${projectInfo.name}
项目描述：${projectInfo.description}

讨论内容：
${messagesText}`;

  // 添加依赖文档作为重点参考（优先级最高）
  if (dependencyDocs.length > 0) {
    userPrompt += `\n\n---\n## 【必须参考】上游依赖文档\n`;
    userPrompt += `> 以下是本文档依赖的上游文档，生成时必须与这些文档保持一致。\n`;
    for (const doc of dependencyDocs) {
      const docTypeName = DOC_TYPE_NAMES[doc.type] || doc.type;
      // 依赖文档给予更多内容空间
      const truncatedContent = doc.content.length > 4000 
        ? doc.content.slice(0, 4000) + '\n...(内容已截断，请确保关键设计决策已包含)'
        : doc.content;
      userPrompt += `\n### 📌 ${docTypeName} - ${doc.title} (v${doc.version})\n${truncatedContent}\n`;
    }
  }

  // 添加历史版本作为参考
  if (previousVersionDoc.length > 0) {
    userPrompt += `\n\n---\n## 【参考】本文档历史版本\n`;
    userPrompt += `> 以下是本文档的上一版本，请在此基础上进行更新。\n`;
    for (const doc of previousVersionDoc) {
      const truncatedContent = doc.content.length > 3000 
        ? doc.content.slice(0, 3000) + '\n...(内容已截断)'
        : doc.content;
      userPrompt += `\n### 📄 ${doc.title} (v${doc.version})\n${truncatedContent}\n`;
    }
  }

  // 添加其他文档作为辅助参考
  if (otherDocs.length > 0) {
    userPrompt += `\n\n---\n## 【辅助参考】其他相关文档\n`;
    userPrompt += `> 以下文档供参考，避免产生冲突。\n`;
    for (const doc of otherDocs) {
      const docTypeName = DOC_TYPE_NAMES[doc.type] || doc.type;
      // 其他文档给予较少空间
      const truncatedContent = doc.content.length > 1500 
        ? doc.content.slice(0, 1500) + '\n...(内容已截断)'
        : doc.content;
      userPrompt += `\n### ${docTypeName} - ${doc.title} (v${doc.version})\n${truncatedContent}\n`;
    }
  }

  userPrompt += `\n\n---\n请基于以上讨论内容和参考文档，生成【${currentDocName}】。确保与上游文档保持一致，避免逻辑冲突。`;

  const response = await chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { provider: provider || config.llm.defaultProvider }
  );

  // 解析文档内容，提取冲突和变更信息
  const result: DocumentGenerationResult = {
    content: response.content,
    conflicts: [],
    changes: [],
  };

  // 尝试从生成的文档中提取冲突和变更信息（支持多种标题格式）
  const conflictPatterns = [
    /### 潜在冲突或待确认事项\n([\s\S]*?)(?=\n##|\n---|\n### |$)/,
    /### 潜在冲突或需要确认的内容\n([\s\S]*?)(?=\n##|\n---|\n### |$)/,
  ];
  
  for (const pattern of conflictPatterns) {
    const conflictMatch = response.content.match(pattern);
    if (conflictMatch) {
      const conflictLines = conflictMatch[1].split('\n').filter(line => line.trim().startsWith('-'));
      result.conflicts = conflictLines.map(line => line.replace(/^-\s*/, '').trim()).filter(Boolean);
      break;
    }
  }

  const changesPatterns = [
    /### 相对于上一版本的变更\n([\s\S]*?)(?=\n###|\n##|\n---|\n### |$)/,
    /### 相对于上一版本的主要变更\n([\s\S]*?)(?=\n###|\n##|\n---|\n### |$)/,
  ];
  
  for (const pattern of changesPatterns) {
    const changesMatch = response.content.match(pattern);
    if (changesMatch) {
      const changeLines = changesMatch[1].split('\n').filter(line => line.trim().startsWith('-'));
      result.changes = changeLines.map(line => line.replace(/^-\s*/, '').trim()).filter(Boolean);
      break;
    }
  }

  // 提取依赖的上游文档信息
  const dependencyMatch = response.content.match(/### 依赖的上游文档\n([\s\S]*?)(?=\n###|\n##|\n---|\n### |$)/);
  if (dependencyMatch) {
    const depLines = dependencyMatch[1].split('\n').filter(line => line.trim().startsWith('-'));
    // 可以将依赖信息也存储起来，便于后续追踪
    console.log('文档依赖关系:', depLines.map(line => line.replace(/^-\s*/, '').trim()));
  }

  return result;
}
