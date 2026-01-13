const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch'); // 使用 node-fetch v2

// Supabase 配置
const SUPABASE_CONFIG = {
  url: 'https://tzgdppffpgpybjwfyrar.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6Z2RwcGZmcGdweWJqd2Z5cmFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NTM1NTYsImV4cCI6MjA4MzMyOTU1Nn0.ruYiYvhOE0vHuZJVsPJ2dF0cuq7QKb4_6xRwtNCKU5c',
  serviceRoleKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6Z2RwcGZmcGdweWJqd2Z5cmFyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Nzc1MzU1NiwiZXhwIjoyMDgzMzI5NTU2fQ.bXa4RqKrKXCtPNCZHzPxB5lWHpLdJe8vX-8B5m7l5K0'
};

// Supabase API 请求函数
async function supabaseRequest(table, options) {
  const url = `${SUPABASE_CONFIG.url}/rest/v1/${table}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_CONFIG.serviceRoleKey,
      'Authorization': `Bearer ${SUPABASE_CONFIG.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...options?.headers
    }
  });

  const data = await response.json();
  return { data, ok: response.ok, status: response.status };
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    backgroundColor: '#1a1a2e',
    titleBarStyle: 'hiddenInset',
    frame: true
  });

  // 加载 HTML 文件
  const htmlPath = path.join(__dirname, 'manager.html');
  mainWindow.loadFile(htmlPath);

  // 开发模式下打开开发者工具
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers

// 生成激活码
ipcMain.handle('generate-codes', async (event, config) => {
  const { batchName, codeType, quantity, expiresInDays, notes } = config;

  // 生成激活码
  const codes = [];
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const existingCodes = new Set();

  for (let i = 0; i < quantity; i++) {
    let code;
    let attempts = 0;

    do {
      code = '';
      for (let j = 0; j < 16; j++) {
        if (j > 0 && j % 4 === 0) code += '-';
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      attempts++;
    } while (existingCodes.has(code) && attempts < 100);

    codes.push(code);
    existingCodes.add(code);
  }

  const batchId = `BATCH_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  return {
    success: true,
    codes,
    batchId,
    expiresAt,
    message: `成功生成 ${quantity} 个激活码`
  };
});

// 保存激活码到文件
ipcMain.handle('save-codes-to-file', async (event, data) => {
  const { codes, batchName, batchId } = data;

  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存激活码',
    defaultPath: `${batchName}_${Date.now()}.txt`,
    filters: [
      { name: '文本文件', extensions: ['txt'] },
      { name: 'CSV文件', extensions: ['csv'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { success: false, message: '保存已取消' };
  }

  try {
    const content = [
      `批次名称: ${batchName}`,
      `批次ID: ${batchId}`,
      `生成时间: ${new Date().toLocaleString('zh-CN')}`,
      `激活码数量: ${codes.length}`,
      '',
      '=== 激活码列表 ===',
      ...codes,
      '',
      '=== 使用说明 ===',
      '激活码格式: XXXX-XXXX-XXXX-XXXX',
      '每个激活码仅可使用一次',
      '请在有效期内使用'
    ].join('\n');

    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { success: true, message: '保存成功', filePath: result.filePath };
  } catch (error) {
    return { success: false, message: '保存失败: ' + error.message };
  }
});

// 读取保存的激活码文件
ipcMain.handle('load-codes-from-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开激活码文件',
    filters: [
      { name: '文本文件', extensions: ['txt'] },
      { name: 'CSV文件', extensions: ['csv'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: '打开已取消' };
  }

  try {
    const content = fs.readFileSync(result.filePaths[0], 'utf-8');
    const codes = content.split('\n')
      .filter(line => /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(line.trim()));

    return {
      success: true,
      codes,
      filePath: result.filePaths[0],
      message: `成功读取 ${codes.length} 个激活码`
    };
  } catch (error) {
    return { success: false, message: '读取失败: ' + error.message };
  }
});

// 验证激活码格式
ipcMain.handle('validate-code', async (event, code) => {
  const formatted = code.toUpperCase().replace(/\s/g, '');
  const pattern = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

  return {
    valid: pattern.test(formatted),
    formatted: formatted
  };
});

// 导出激活码数据
ipcMain.handle('export-codes', async (event, data) => {
  const { codes, batchInfo, format } = data;

  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出激活码',
    defaultPath: `激活码_${batchInfo.batchName}_${Date.now()}.${format}`,
    filters: [
      { name: format.toUpperCase(), extensions: [format] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { success: false, message: '导出已取消' };
  }

  try {
    let content;

    if (format === 'csv') {
      content = [
        '序号,激活码,批次ID,批次名称,类型,状态,过期时间',
        ...codes.map((code, index) =>
          `${index + 1},${code},${batchInfo.batchId},${batchInfo.batchName},${batchInfo.codeType},可用,${batchInfo.expiresAt || '永不过期'}`
        )
      ].join('\n');
    } else if (format === 'json') {
      content = JSON.stringify({
        batchInfo,
        codes,
        exportedAt: new Date().toISOString()
      }, null, 2);
    } else {
      content = codes.join('\n');
    }

    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { success: true, message: '导出成功', filePath: result.filePath };
  } catch (error) {
    return { success: false, message: '导出失败: ' + error.message };
  }
});

// 获取应用信息
ipcMain.handle('get-app-info', async () => {
  return {
    name: '凌动灯塔激活码管理系统',
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch
  };
});

// ==================== 数据库操作 ====================

// 测试数据库连接
ipcMain.handle('test-database-connection', async () => {
  try {
    const result = await supabaseRequest('activation_codes?select=id&limit=1', { method: 'GET' });
    return {
      success: result.ok,
      message: result.ok ? '数据库连接成功' : '数据库连接失败',
      status: result.status
    };
  } catch (error) {
    return {
      success: false,
      message: '连接错误: ' + error.message
    };
  }
});

// 保存激活码到数据库
ipcMain.handle('save-codes-to-database', async (event, data) => {
  const { codes, batchInfo } = data;

  try {
    setStatus('正在保存到数据库...');

    // 准备批量插入数据
    const insertData = codes.map(code => ({
      code: code,
      batch_id: batchInfo.batchId,
      batch_name: batchInfo.batchName,
      code_type: batchInfo.codeType,
      status: 'active',
      expires_at: batchInfo.expiresAt || null,
      notes: batchInfo.notes || null,
      generated_by: 'admin'
    }));

    // 批量插入激活码
    const result = await supabaseRequest('activation_codes', {
      method: 'POST',
      body: JSON.stringify(insertData)
    });

    if (result.ok) {
      return {
        success: true,
        message: `成功保存 ${codes.length} 个激活码到数据库`,
        savedCount: codes.length
      };
    } else {
      return {
        success: false,
        message: '保存失败: ' + JSON.stringify(result.data)
      };
    }
  } catch (error) {
    return {
      success: false,
      message: '保存失败: ' + error.message
    };
  }
});

// 从数据库查询激活码
ipcMain.handle('query-codes-from-database', async (event, filters = {}) => {
  try {
    let query = 'activation_codes?select=*';

    // 添加过滤条件
    const conditions = [];
    if (filters.status) {
      conditions.push(`status=eq.${filters.status}`);
    }
    if (filters.codeType) {
      conditions.push(`code_type=eq.${filters.codeType}`);
    }
    if (filters.batchId) {
      conditions.push(`batch_id=eq.${filters.batchId}`);
    }

    if (conditions.length > 0) {
      query += '&' + conditions.join('&');
    }

    // 添加排序和限制
    query += '&order=created_at.desc&limit=100';

    const result = await supabaseRequest(query, { method: 'GET' });

    if (result.ok) {
      return {
        success: true,
        codes: result.data,
        count: result.data.length,
        message: `查询到 ${result.data.length} 条激活码记录`
      };
    } else {
      return {
        success: false,
        message: '查询失败: ' + JSON.stringify(result.data)
      };
    }
  } catch (error) {
    return {
      success: false,
      message: '查询失败: ' + error.message
    };
  }
});

// 获取激活码统计信息
ipcMain.handle('get-code-statistics', async () => {
  try {
    // 获取各状态的激活码数量
    const [activeResult, usedResult, expiredResult] = await Promise.all([
      supabaseRequest('activation_codes?status=eq.active&select=count', { method: 'GET' }),
      supabaseRequest('activation_codes?status=eq.used&select=count', { method: 'GET' }),
      supabaseRequest('activation_codes?status=eq.expired&select=count', { method: 'GET' })
    ]);

    return {
      success: true,
      statistics: {
        active: activeResult.data?.length || 0,
        used: usedResult.data?.length || 0,
        expired: expiredResult.data?.length || 0,
        total: (activeResult.data?.length || 0) + (usedResult.data?.length || 0) + (expiredResult.data?.length || 0)
      }
    };
  } catch (error) {
    return {
      success: false,
      message: '获取统计信息失败: ' + error.message
    };
  }
});

// 设置状态消息的辅助函数
function setStatus(text) {
  if (mainWindow) {
    mainWindow.webContents.send('status-update', text);
  }
}
