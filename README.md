# AI Psychologist · 心理陪伴

一个面向中文成年人的隐私优先心理陪伴原型：把自然情绪对话、按需加载的心理支持 Skill、语音交互和安静的数字人界面放在同一个本地应用里。

> 这是 AI 心理陪伴产品原型，不是持证心理医生、疾病诊断工具或急救服务。出现已经发生的伤害或迫近危险时，请立即联系当地急救和身边可信任的人；在中国大陆可拨打 `120`、`110`，非紧急真人心理支持可联系 `12356`。

![心理陪伴主界面](docs/images/product-main.png)

## 产品特点

- **自然陪伴优先**：普通难过、孤独和压力不会被强制变成问卷或疾病评估。
- **Skill 按需路由**：根据用户意图加载倾听、评估、行动支持、安全边界或特定状况知识；一次只聚焦一个主要问题。
- **隐私默认**：不主动索取身份信息，不自动长期保存会谈；密钥仅在服务端环境变量中读取。
- **可替换回复模型**：支持演示模式、本地 Ollama 和 OpenAI-compatible API（包括硅基流动等兼容服务）。
- **语音输入与输出**：支持本地 sherpa-onnx 中文语音识别；可选系统语音或服务端神经语音合成。
- **克制的数字人表达**：使用连续人物图层、轻微眨眼与口型，让界面有陪伴感但不过度表演。

## 界面预览

| 私人会谈与设置 | 移动端布局 |
| --- | --- |
| ![会谈侧边栏和隐私设置](docs/images/product-settings.png) | ![移动端心理陪伴界面](docs/images/product-mobile.png) |

## 运行方式

环境要求：Node.js 20.9 或更高版本。

```bash
npm install
cp .env.example .env.local
npm run dev
```

然后打开 [http://localhost:3000](http://localhost:3000)。默认 `demo` 模式不需要 API Key，可以直接体验界面、路由和固定演示回复。

### 配置文字回复模型

在不会提交到 Git 的 `.env.local` 中配置。例如 OpenAI-compatible 服务：

```dotenv
COMPANION_LLM_PROVIDER=openai-compatible
COMPANION_LLM_BASE_URL=https://your-provider.example
COMPANION_LLM_MODEL=your-model
COMPANION_LLM_API_KEY=your-server-side-key
```

也可以使用本机 Ollama：

```dotenv
COMPANION_LLM_PROVIDER=ollama
COMPANION_LLM_BASE_URL=http://127.0.0.1:11434
COMPANION_LLM_MODEL=qwen3:8b
```

### 配置语音

本地语音识别使用 `sherpa-onnx`，模型权重因体积较大未包含在仓库中。将兼容模型放到：

```text
models/sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30/
```

或通过 `COMPANION_ASR_MODEL_DIR` 指向模型目录。模型目录至少需要 `model.int8.onnx` 与 `tokens.txt`，也支持 encoder/decoder/joiner 形式的 Zipformer 模型。

神经语音输出为可选项，配置示例见 `.env.example`。开启网络 TTS 时，只发送模型生成的回答文字，不上传麦克风原始录音；未配置时可在 macOS 使用系统语音兜底。

## Skill 工作方式

核心规则位于 [`skill/psychological-companion`](skill/psychological-companion)。后端不会把所有疾病资料一股脑塞给模型，而是先由确定性路由判断当前需要：

```text
用户消息
  → 安全信号与意图路由
  → 日常陪伴 / 梳理评估 / 行动支持 / 安全流程
  → 按需加载少量 references
  → 生成口语化回复与数字人情绪标签
```

疾病知识只在用户明确提到诊断、主动要求评估，或持续时间与功能受损等信号较明确时加载。量表与分数仅用于自我观察，不作为诊断。危机流程直接询问现实安全，并优先连接急救与现实支持。

## 目录结构

```text
src/pages/index.tsx                       数字人会谈界面
src/pages/api/companion-chat.ts           回复模型与会话 API
src/pages/api/local-speech.ts             本地语音识别 API
src/pages/api/local-voice.ts              语音合成 API
src/features/psychologicalCompanion/      路由、语音和人物状态
src/server/companionPrompt.ts             Skill 按需组合
skill/psychological-companion/            核心规则与参考知识
public/companion-assets/                  展示用人物和空间素材
```

## 隐私与公开范围

本公开版本经过脱敏，只上传可运行的核心子集和展示素材。以下内容明确排除：

- `.env.local`、API Key、账号密码和部署凭据；
- 原始录音、真实会谈记录、用户资料和长期记忆；
- 本地 ASR 模型权重、构建产物、日志和依赖目录；
- 开发机器的绝对路径和私人项目文件。

详见 [`SECURITY.md`](SECURITY.md)。请注意：应用层设计无法替底层模型服务或部署平台承诺“绝不留存”，上线前仍需审查所选供应商的数据政策、日志与跨境传输设置。

## 验证

```bash
npm test
npm run typecheck
npm run build
```

测试覆盖日常陪伴与疾病资料分流、直接安全信号、服药过量识别、连续评估疲劳、人物图层连续性和语音分句预加载。

## 当前边界

- 第一版面向中文成年人；未成年人场景只提供基础安全支持与现实转介。
- 不诊断、不调整药物、不做暴露治疗或深层创伤加工。
- 不制造排他关系，也不宣称绝对保密。
- 演示人物素材用于产品原型展示；在商业分发前请再次确认相应素材权利。

本仓库目前未附带开源许可证；未经授权不自动授予复制、修改或商业使用权。
