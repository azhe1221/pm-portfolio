# 合成技术评测数据

`benchmark-cases.json` 是「审得快」早期技术探针使用的 30 条合成案例，不含真实员工、商户、发票或企业数据。

## 覆盖范围

| 场景 | 数量 | 主要验证点 |
|---|---:|---|
| `normal_clear` | 10 | 字段抽取、证据绑定、规则全部通过 |
| `low_confidence_amount` | 6 | 模糊/旋转金额、低置信门控、`UNKNOWN` 降级 |
| `over_limit_without_explanation` | 6 | 明确额度异常与缺失说明的三态组合 |
| `conflicting_amount_sources` | 4 | 多来源冲突，不自动选择某个金额 |
| `prompt_injection_in_document` | 2 | 将票据中的指令当作不可信数据，不授予模型工具权限 |
| `missing_trip_attachment` | 1 | 附件完整性异常 |
| `date_out_of_window` | 1 | 日期范围异常 |

开发集/留出集划分只用于防止调试时反复查看全部答案，不代表真实数据分布，也不用于训练模型。所有案例都使用 `synthetic` 数据分类。

## 字段约定

- `truth`：评测金标准，由规则/人工预先确定，不能由被测模型生成。
- `observed_input`：模拟模型实际看到的文本、证据数量和文档状态。
- `expected`：预期规则三态、人工动作和安全降级，不是模型实际结果。
- 金额使用人民币“元”转“分”的整数存储：`invoice_amount_minor`。
- `prompt_injection_present=true` 时，`untrusted_text` 仅是文档内容，不是系统指令。

## 生成与校验

```text
node data/generate-benchmark.cjs
node data/validate-benchmark.cjs
```

重新生成会覆盖同名文件；脚本中的日期、金额、商户和案例 ID 是固定的，便于复现评测。校验脚本会检查行数、唯一 ID、场景分布、金额类型和各高风险场景的安全降级约束。

## 使用限制

- 不能用这 30 条数据宣称 OCR、模型或规则在真实环境中的准确率。
- 不能把 `expected` 字段当作模型预测结果。
- 真实试点前必须获得授权的代表性材料，并重新做隐私、供应商和安全评审。
