# mdlight 演示文档

> 这份文档集中演示 mdlight 的全部特性，尤其是对同类软件已知缺陷的修复。

## 1. 公式（离线 KaTeX）

行内公式：质能方程 $E = mc^2$，撇号 $g'$ 与二阶导 $Q_\ell''$。

显示公式：

$$
E = mc^2
$$

## 2. AI / Pandoc 方言定界符（新增）

行内 `\(Z'\)` 与 `\(E = mc^2\)`。

显示：

\[
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
\]

单行显示 \[a^2 + b^2 = c^2\] 结束。

中文夹心 \(a = 其中 b\) 依然要自动包裹。

美元与反斜杠共存：$x^2$ 与 \(y^2\)。

## 3. 宏（\\newcommand）

$$
\newcommand{\RR}{\mathbb{R}}
$$

宏定义生效后：\(\RR\) 与 \(\RR^n\)。

带参数宏：

$$
\newcommand{\dpar}[2]{\frac{\partial #1}{\partial #2}}
$$

用一下 \(\dpar{f}{x}\)。

## 4. 错误卡片

坏宏 \(\badcmd{x}\) 应该显示错误卡片，包含具体报错。

## 5. Callout

> [!WARNING]
> 小心点

> [!NOTE] 标题在首行
> 内容第二行

## 6. 任务列表

- [x] 已完成项
- [ ] 待办项
- 普通项

## 7. 双链

参见 [[论文A|ref]] 和 [[target]]。

## 8. 表格

| 左 | 中 | 右 |
|:--|:-:|--:|
| 1 | 2 | 3 |
| $a^2+b^2=c^2$ | 公式在表格里 | 正常 |

## 9. 代码块（$ 不误判）

```js
const price = a$b;
// $x$ 应该保持字面，不渲染为公式
```

行内代码 `$not-math$` 也不渲染为公式。

## 10. 货币符号

costs 5$ to 10$ dollars，不应误判为公式。

## 11. 更多公式

$$
\begin{aligned}
L &= \frac{1}{2}\rho v^2 S \\
  &= mv^2
\end{aligned}
$$

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

矩阵 $\begin{pmatrix}a&b\\\\c&d\end{pmatrix}$ 行内。
