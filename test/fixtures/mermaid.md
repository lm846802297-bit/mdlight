# mermaid 测试夹具

普通段落，确认渲染管线正常。

```mermaid
graph TD
  A[开始] --> B{判断}
  B -->|是| C[执行]
  B -->|否| D[结束]
```

## 时序图

```mermaid
sequenceDiagram
  Alice->>Bob: 你好
  Bob-->>Alice: 你也好
```

## 饼图

```mermaid
pie title 占比
  "甲" : 40
  "乙" : 60
```

## 没有 mermaid 的代码块（不应受影响）

```js
const a = 1;
console.log(a);
```

## 错误图表（测错误卡片）

```mermaid
graph TD
  A[ --> B
```

## 一个普通公式

$$E = mc^2$$
