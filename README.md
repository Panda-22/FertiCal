# FertiCal · 丰码有料 UniMix

FertiCal is a nutrient solution calculator and reverse fertilizer recipe designer for fertigation workflows. The current web app, branded as **丰码有料 UniMix**, puts raw water background, A/B stock tanks, target element concentrations, theoretical working solution results, pH estimation, and precipitation risk checks into one workspace.

FertiCal 是一个用于营养液配方核算和反向生成施肥方案的工具。当前页面名称为 **丰码有料 UniMix**，目标是把原水背景、A/B 桶母液配方、目标元素浓度、理论工作液结果、pH 估算和析出风险放在同一张工作台中，方便快速评估方案是否接近目标。

> Current note: the formula library is not enabled yet. Raw water data can be uploaded through the local backend or entered manually.
>
> 当前说明：配方库暂未启用。原水数据支持通过本地后端上传识别，也可以直接手动输入。

## Contents

- [English](#english)
- [中文说明](#中文说明)

## English

### Features

**Mode 01: Calculate working solution**

- Upload a water report, or manually edit raw water background values.
- Import target files and actual formula files to fill target values and A/B tank dosages.
- Manually configure fertilizers, stock tank volumes, and dilution ratios for A and B tanks.
- Calculate theoretical working solution concentrations, target deviation, EC, pH, and A/B tank precipitation risk in real time.
- Export theoretical irrigation solution calculation results.

**Mode 02: Design fertilizer recipe**

- Upload or manually enter raw water background.
- Select a target preset, or enter target element concentrations manually.
- Generate three alternative recipe suggestions:
  - closest target fit
  - low chloride / low sulfur priority
  - lowest raw material cost
- Apply any suggested recipe into A/B tanks and immediately compare the final working solution; the other suggestions remain available for comparison.
- Estimate acid demand from raw water alkalinity before solving the rest of the formula. `HCO3-` contributes 1 equivalent and `CO3--` contributes 2 equivalents.
- Account for nutrients introduced by nitric acid and phosphoric acid before solving the remaining fertilizer needs.
- Prioritize working solution pH around the target value at 100x dilution. Recipes outside the pH tolerance are warned or rejected.
- Export the selected recipe as Excel or PDF after choosing a stock preparation volume such as `100 L` or `1000 L`.

### Calculation Scope

- Raw water background: `N`, `NO3-N`, `NH4-N`, `P`, `K`, `Ca`, `Mg`, `S`, `Cl`, trace elements, `EC`, `pH`, `HCO3-`, `CO3--`, and related indicators.
- A/B tank contribution: converts fertilizer element percentages, dosage, stock tank volume, and dilution ratio into working solution element contribution.
- Theoretical working solution: raw water background plus A tank and B tank contribution.
- Target deviation: compares theoretical values with target values and highlights large deviations.
- pH estimation: combines alkalinity, nitric acid, phosphoric acid, monopotassium phosphate, and other acidifying sources. This is an engineering estimate for recipe comparison, not a laboratory-grade pH prediction.
- Precipitation risk: estimates `CaSO4·2H2O` and `Ca3(PO4)2` ion product risk in A/B tanks using approximate `mol/L` activity assumptions.
- Recipe scoring: separates cation and anion fitting, handles `NO3-N` / `NH4-N`, applies warning and rejection ranges for macro, secondary, and trace nutrients, and treats `EC` as a dilution reference instead of a score penalty.

### Supported Imports

- Water report: `.xlsx`, `.xls`, `.csv`, `.txt`, `.pdf`, images
- Target file: `.pdf`, `.xlsx`, `.xls`, `.csv`, `.txt`, images
- Formula file: `.xlsx`, `.xls`, `.csv`, `.txt`, `.pdf`, images

Spreadsheet files are the most stable import format. PDF and image recognition depend on the local backend text extraction and OCR environment.

### Run Locally

Install frontend dependencies:

```bash
npm install
```

Open `index.html` directly in a browser, or serve the project folder with any static file server. A static server is recommended for file import testing and debugging.

### Optional Local Backend

The frontend can work with manual input by itself. For PDF, image OCR, file parsing, saved water reports, saved formulas, and titration records, start the local backend:

```bash
cd backend
pip install -r requirements.txt
python main.py
```

The backend listens on:

```text
http://127.0.0.1:8765
```

Image OCR requires the Tesseract binary in addition to Python packages. See `backend/requirements.txt` for installation notes.

### GitHub Pages

This repository includes `.github/workflows/pages.yml`. After pushing to `main`, GitHub Actions can publish the frontend files:

1. Open the GitHub repository settings.
2. Go to `Pages`.
3. Set `Source` to `GitHub Actions`.
4. Push to `main` and wait for the `Deploy frontend to GitHub Pages` workflow.
5. The expected Pages URL is usually `https://panda-22.github.io/FertiCal/`.

GitHub Pages only publishes the static frontend (`index.html`, `app.js`, `styles.css`). Manual entry, Excel/CSV import, calculation, and recipe suggestion can be used in the hosted frontend. PDF/image OCR and backend upload parsing are local-backend features and are not included in the static Pages deployment.

### Project Structure

```text
FertiCal/
├── .github/workflows/pages.yml  # GitHub Pages deployment workflow
├── backend/
│   ├── main.py                  # FastAPI backend for imports and local records
│   ├── requirements.txt         # Python backend dependencies
│   └── start.sh                 # Convenience backend starter
├── app.js                       # Core calculations, import/export, and UI logic
├── index.html                   # Main application page
├── package.json                 # Frontend dependency metadata
├── styles.css                   # Additional styles
└── README.md                    # Project documentation
```

### Dependencies

- Frontend: [`xlsx`](https://www.npmjs.com/package/xlsx)
- Backend: FastAPI, Uvicorn, pypdf, openpyxl, Pillow, pytesseract
- Optional OCR binary: Tesseract

### Known Limits

- pH and precipitation risk are design-stage estimates. They are suitable for comparing recipes and spotting risks, but production use should still include lab checks and small-batch validation.
- Actual pH can be affected by water temperature, CO2 release speed, fertilizer purity, and mixing process.
- Laboratory water report field names vary. Always review key raw water values after automatic recognition.
- The static GitHub Pages version does not run the local backend.

## 中文说明

### 当前功能

**功能 01：计算工作液浓度**

- 上传水质检测报告，或直接手动修改原水背景值。
- 导入目标文件与实际配方文件，自动填入目标值和 A/B 桶用量。
- 手动配置 A 桶、B 桶肥料、母液体积和稀释倍数。
- 内置库存肥料包含硝酸钙、硝酸镁、硝酸钾、硫酸镁、磷酸二氢钾、四水八硼、螯合锰、螯合锌、螯合铜等常用水溶肥；硝酸镁、四水八硼和螯合态微肥可在 A/B 桶中选择。
- 实时计算理论工作液浓度、目标偏差、EC、pH 和 A/B 桶析出风险。
- 支持导出理论灌溉液计算结果。

**功能 02：设计施肥配方**

- 上传或手动录入原水背景。
- 选择目标预设，或手动录入目标元素浓度。
- 自动生成 3 套可选配方建议：
  - 目标贴合优先
  - 低氯低硫优先
  - 原料成本最低
- 点击任一方案后，方案会写入 A/B 桶并计算最终工作液浓度，另外两套方案仍会保留，方便继续对比。
- 默认 100 倍稀释工作液 pH 优先控制在目标值附近，偏离超过阈值时标黄或弃用。
- 反向生成时会先按原水 `HCO3-` / `CO3--` 的碱度当量估算调酸需求，再把硝酸 / 磷酸带来的 `NO3-N` / `P` 从目标中扣除后求解其它肥料。
- 反向生成微量元素时会优先使用四水八硼、螯合锰、螯合锌、螯合铜；铁源按目标 pH 在 EDTA-Fe 13、DTPA-Fe 11、EDDHA-Fe 6 之间选择。
- 反向生成前可设置推荐偏好：铁源策略、微量元素是否优先螯合态、成本控制强度、硝酸 / 磷酸是否可用；硝酸默认尽量不用，适配管制危化品采购场景。
- 选择 AB 肥配制量后，可将已选方案导出为 Excel 或 PDF。

### 主要计算内容

- 原水背景：识别并记录 `N`、`NO3-N`、`NH4-N`、`P`、`K`、`Ca`、`Mg`、`S`、`Cl`、微量元素、`EC`、`pH`、`HCO3-`、`CO3--` 等指标。
- A/B 桶贡献：根据肥料元素百分比、用量、母液体积和稀释倍数，换算为工作液中的元素贡献。
- 理论工作液：原水背景 + A 桶贡献 + B 桶贡献。
- 目标偏差：计算理论值与目标值的偏差，偏差较大时在页面中提示。
- pH 估算：结合原水碱度、硝酸、磷酸、磷酸二氢钾等酸性来源进行估算。`HCO3-` 按 1 倍、`CO3--` 按 2 倍碱度当量进入酸需求。
- 析出风险：估算 A/B 桶中 `CaSO4·2H2O` 和 `CaHPO4·2H2O` 的离子积风险；IP 与 Ksp 用 `mol/L` 浓度近似活度进行比较。
- 方案评分：反向找配方时将阴离子和阳离子分开拟合，氮素按 `NO3-N` / `NH4-N` 处理；中大量元素、微量元素、铵态氮比例、pH 偏差和原料成本会参与提示或扣分；`EC` 作为稀释倍数可调的参考值展示，不作为扣分项。

### 支持导入的文件

- 水质报告：`.xlsx`、`.xls`、`.csv`、`.txt`、`.pdf`、图片
- 目标文件：`.pdf`、`.xlsx`、`.xls`、`.csv`、`.txt`、图片
- 配方文件：`.xlsx`、`.xls`、`.csv`、`.txt`、`.pdf`、图片

图片和 PDF 的识别能力依赖本地后端的 OCR / 文本提取能力；表格类文件识别更稳定。

### 使用方法

安装前端依赖：

```bash
npm install
```

然后在浏览器中打开 `index.html` 即可使用。也可以用任意静态文件服务打开项目目录；静态服务在文件导入和调试时更稳定。

### 可选本地后端

如果需要 PDF / 图片 OCR、上传解析、保存水质报告、保存配方或保存滴定记录，可以启动本地后端：

```bash
cd backend
pip install -r requirements.txt
python main.py
```

默认监听：

```text
http://127.0.0.1:8765
```

图片 OCR 除 Python 包外还需要安装 Tesseract 二进制程序，安装说明见 `backend/requirements.txt`。

### GitHub Pages 试发布

项目已包含 `.github/workflows/pages.yml`，推送到 `main` 后会自动发布前端文件：

1. 在 GitHub 仓库进入 `Settings` → `Pages`。
2. `Source` 选择 `GitHub Actions`。
3. 推送代码到 `main`，等待 `Deploy frontend to GitHub Pages` 工作流完成。
4. 打开 Pages 给出的地址，通常是 `https://panda-22.github.io/FertiCal/`。

GitHub Pages 只发布静态前端文件：`index.html`、`app.js`、`styles.css`。手动录入、Excel/CSV 水质报告导入、计算和配方建议可用于在线试用；PDF/图片 OCR、目标文件和配方文件等依赖后端的上传解析接口不包含在静态 Pages 发布版本里。

### 项目结构

```text
FertiCal/
├── .github/workflows/pages.yml  # GitHub Pages 自动部署
├── backend/
│   ├── main.py                  # FastAPI 后端：导入解析与本地记录
│   ├── requirements.txt         # Python 后端依赖
│   └── start.sh                 # 后端启动脚本
├── app.js                       # 计算逻辑、导入导出和交互
├── index.html                   # 主页面
├── package.json                 # 前端依赖
├── styles.css                   # 补充样式
└── README.md                    # 项目说明
```

### 依赖

- 前端：[`xlsx`](https://www.npmjs.com/package/xlsx)
- 后端：FastAPI、Uvicorn、pypdf、openpyxl、Pillow、pytesseract
- 可选 OCR 二进制程序：Tesseract

### 已知边界

- pH 和析出风险为配方设计阶段的估算结果，适合用于方案比较和风险预警；生产仍建议结合检测与小样验证。
- 实际 pH 可能受水温、CO2 逸出速度、肥料纯度、混配流程等因素影响。
- 不同实验室报告字段命名不完全一致，自动识别后仍建议人工检查关键原水指标。
- GitHub Pages 静态版本不包含本地后端能力。
