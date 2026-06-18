#!/bin/bash

echo "========================================"
echo "  YOLO检测训练平台 - 一键启动脚本"
echo "========================================"
echo ""

# 配置项
CONDA_ENV="yolo"
BACKEND_PORT=3001
FRONTEND_PORT=5173

# 询问用户配置
read -p "请输入Conda环境名称 (默认: $CONDA_ENV): " INPUT_CONDA_ENV
if [ -n "$INPUT_CONDA_ENV" ]; then
    CONDA_ENV=$INPUT_CONDA_ENV
fi

read -p "请输入后端端口号 (默认: $BACKEND_PORT): " INPUT_BACKEND_PORT
if [ -n "$INPUT_BACKEND_PORT" ]; then
    BACKEND_PORT=$INPUT_BACKEND_PORT
fi

read -p "请输入前端端口号 (默认: $FRONTEND_PORT): " INPUT_FRONTEND_PORT
if [ -n "$INPUT_FRONTEND_PORT" ]; then
    FRONTEND_PORT=$INPUT_FRONTEND_PORT
fi

echo ""
echo "配置信息:"
echo "- Conda环境: $CONDA_ENV"
echo "- 后端端口: $BACKEND_PORT"
echo "- 前端端口: $FRONTEND_PORT"
echo ""

# 杀死占用端口的进程
echo "[1/4] 检查并释放端口..."

# 检查后端端口
BACKEND_PID=$(lsof -ti:$BACKEND_PORT 2>/dev/null)
if [ -n "$BACKEND_PID" ]; then
    echo "发现进程占用后端端口 $BACKEND_PORT (PID: $BACKEND_PID)，正在终止..."
    kill -9 $BACKEND_PID 2>/dev/null
    sleep 1
fi

# 检查前端端口
FRONTEND_PID=$(lsof -ti:$FRONTEND_PORT 2>/dev/null)
if [ -n "$FRONTEND_PID" ]; then
    echo "发现进程占用前端端口 $FRONTEND_PORT (PID: $FRONTEND_PID)，正在终止..."
    kill -9 $FRONTEND_PID 2>/dev/null
    sleep 1
fi

echo "端口检查完成"
echo ""

# 获取Python路径
echo "[2/4] 获取Python路径..."

# 初始化conda（脚本环境中conda可能不可用）
if [ -f "$HOME/miniconda3/etc/profile.d/conda.sh" ]; then
    source "$HOME/miniconda3/etc/profile.d/conda.sh"
elif [ -f "$HOME/anaconda3/etc/profile.d/conda.sh" ]; then
    source "$HOME/anaconda3/etc/profile.d/conda.sh"
elif [ -f "/opt/conda/etc/profile.d/conda.sh" ]; then
    source "/opt/conda/etc/profile.d/conda.sh"
elif command -v conda &>/dev/null; then
    eval "$(conda shell.bash hook)"
fi

CONDA_BASE=$(conda info --base 2>/dev/null)
if [ -z "$CONDA_BASE" ]; then
    echo "[错误] 无法找到Conda安装路径"
    echo "请检查Conda是否正确安装"
    exit 1
fi
echo "Conda路径: $CONDA_BASE"

PYTHON_PATH="$CONDA_BASE/envs/$CONDA_ENV/bin/python"
if [ ! -f "$PYTHON_PATH" ]; then
    echo "[错误] Python可执行文件不存在: $PYTHON_PATH"
    echo "请检查:"
    echo "1. Conda环境 '$CONDA_ENV' 是否存在 (运行 'conda env list')"
    echo "2. 环境名称是否正确"
    echo ""
    echo "可用的Conda环境:"
    conda env list 2>/dev/null || echo "(无法列出环境)"
    exit 1
fi
echo "Python路径: $PYTHON_PATH"
echo ""

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# 启动后端
echo "[3/4] 启动后端服务器 (端口: $BACKEND_PORT)..."
gnome-terminal --title="YOLO后端服务" -- bash -c "export PYTHON_PATH=$PYTHON_PATH && export PORT=$BACKEND_PORT && cd $SCRIPT_DIR && npm run server:dev; exec bash" 2>/dev/null || \
xterm -title "YOLO后端服务" -e "export PYTHON_PATH=$PYTHON_PATH && export PORT=$BACKEND_PORT && cd $SCRIPT_DIR && npm run server:dev; exec bash" 2>/dev/null || \
osascript -e "tell application \"Terminal\" to do script \"export PYTHON_PATH=$PYTHON_PATH && export PORT=$BACKEND_PORT && cd $SCRIPT_DIR && npm run server:dev\"" 2>/dev/null || \
echo "无法自动打开终端，请手动运行: export PYTHON_PATH=$PYTHON_PATH && export PORT=$BACKEND_PORT && npm run server:dev"

sleep 2
echo "后端服务器启动中..."
echo ""

# 启动前端
echo "[4/4] 启动前端开发服务器 (端口: $FRONTEND_PORT)..."
gnome-terminal --title="YOLO前端服务" -- bash -c "export BACKEND_PORT=$BACKEND_PORT && cd $SCRIPT_DIR && npm run client:dev -- --port $FRONTEND_PORT; exec bash" 2>/dev/null || \
xterm -title "YOLO前端服务" -e "export BACKEND_PORT=$BACKEND_PORT && cd $SCRIPT_DIR && npm run client:dev -- --port $FRONTEND_PORT; exec bash" 2>/dev/null || \
osascript -e "tell application \"Terminal\" to do script \"export BACKEND_PORT=$BACKEND_PORT && cd $SCRIPT_DIR && npm run client:dev -- --port $FRONTEND_PORT\"" 2>/dev/null || \
echo "无法自动打开终端，请手动运行: BACKEND_PORT=$BACKEND_PORT npm run client:dev -- --port $FRONTEND_PORT"

sleep 2
echo "前端服务器启动中..."
echo ""

echo "========================================"
echo "  启动完成！"
echo "========================================"
echo ""
echo "后端地址: http://localhost:$BACKEND_PORT"
echo "前端地址: http://localhost:$FRONTEND_PORT"
echo ""
echo "提示:"
echo "- 新终端窗口已打开，分别运行后端和前端"
echo "- 关闭终端窗口即可停止服务"
echo "- 如遇端口冲突，重新运行此脚本"
echo ""
