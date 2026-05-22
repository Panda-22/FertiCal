#!/bin/bash
# FertiCal 后端一键启动脚本
# 用法：./start.sh

cd "$(dirname "$0")"

# 检查/安装依赖
echo "检查 Python 依赖..."
pip install -r requirements.txt -q

echo "启动 FertiCal 后端（http://127.0.0.1:8765）"
echo "按 Ctrl+C 停止"
python main.py
