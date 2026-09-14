// ipinfo.io配置
const API_BASE_URL = 'https://ipinfo.io/';

// 页面元素
const elements = {
    ipInput: null,
    loading: null,
    error: null,
    ipInfo: null,
    searchBtn: null
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 获取页面元素
    elements.ipInput = document.getElementById('ipInput');
    elements.loading = document.getElementById('loading');
    elements.error = document.getElementById('error');
    elements.ipInfo = document.getElementById('ipInfo');
    elements.searchBtn = document.getElementById('searchBtn');

    // 绑定回车键事件
    elements.ipInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            queryIP();
        }
    });

    // 自动查询当前IP
    queryMyIP();
});

// 显示加载状态
function showLoading() {
    elements.loading.style.display = 'block';
    elements.error.style.display = 'none';
    elements.ipInfo.style.display = 'none';
}

// 隐藏加载状态
function hideLoading() {
    elements.loading.style.display = 'none';
}

// 显示错误信息
function showError(message) {
    elements.error.textContent = message;
    elements.error.style.display = 'block';
    elements.ipInfo.style.display = 'none';
}

// 验证IP地址格式
function validateIP(ip) {
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) {
        return false;
    }

    const parts = ip.split('.');
    return parts.every(part => {
        const num = parseInt(part, 10);
        return num >= 0 && num <= 255;
    });
}

// 查询IP地址
async function queryIP() {
    const ip = elements.ipInput.value.trim();

    if (!ip) {
        showError('⚠️ 请输入IP地址');
        return;
    }

    if (!validateIP(ip)) {
        showError('⚠️ 请输入有效的IP地址格式（如：8.8.8.8）');
        return;
    }

    await fetchIPInfo(ip);
}

// 查询当前用户的IP
async function queryMyIP() {
    await fetchIPInfo('');
}

// 获取IP信息
async function fetchIPInfo(ip) {
    showLoading();

    try {
        const url = ip ? `${API_BASE_URL}${ip}/json` : `${API_BASE_URL}json`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error('网络请求失败或IP地址无效');
        }

        const data = await response.json();

        // ipinfo.io 使用 bogon 字段表示无效IP
        if (data.bogon) {
            throw new Error('查询失败，请检查IP地址是否正确');
        }

        displayIPInfo(data);

        // 如果是查询当前IP，自动填入输入框
        if (!ip) {
            elements.ipInput.value = data.ip;
        }

    } catch (error) {
        console.error('查询IP信息失败:', error);
        showError(`❌ 查询失败: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// 显示IP信息
function displayIPInfo(data) {
    // 更新IP地址
    document.getElementById('ipAddress').textContent = data.ip;

    // 更新IP类型（根据是否为内网IP判断）
    const ipType = isPrivateIP(data.ip) ? '内网IP' : '公网IP';
    document.getElementById('ipType').textContent = ipType;

    // 解析经纬度
    let lat = null, lon = null;
    if (data.loc) {
        const [latitude, longitude] = data.loc.split(',');
        lat = parseFloat(latitude);
        lon = parseFloat(longitude);
    }

    // 解析组织和ISP信息
    // ipinfo.io 的 org 格式通常是 "AS号 ISP名称"
    let ispName = data.org || '-';
    let orgName = data.org || '-';

    if (data.org && data.org.includes(' ')) {
        // 提取AS号后面的ISP名称
        const parts = data.org.split(' ');
        orgName = parts[0]; // AS号
        ispName = parts.slice(1).join(' '); // ISP名称
    }

    // 更新各项信息
    document.getElementById('country').textContent = data.country || '-';
    document.getElementById('region').textContent = data.region || '-';
    document.getElementById('city').textContent = data.city || '-';
    document.getElementById('zip').textContent = data.postal || '-';
    document.getElementById('isp').textContent = ispName;
    document.getElementById('org').textContent = orgName;
    document.getElementById('location').textContent =
        lat && lon ? `${lat}, ${lon}` : '-';
    document.getElementById('timezone').textContent = data.timezone || '-';

    // 更新地图链接
    const mapLink = document.getElementById('mapLink');
    if (lat && lon) {
        mapLink.innerHTML = `
            <p>📌 在地图上查看：</p>
            <a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank">
                Google Maps
            </a>
            &nbsp;|&nbsp;
            <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}&zoom=12" target="_blank">
                OpenStreetMap
            </a>
        `;
    } else {
        mapLink.innerHTML = '<p>暂无地理位置信息</p>';
    }

    // 显示结果
    elements.error.style.display = 'none';
    elements.ipInfo.style.display = 'block';
}

// 判断是否为内网IP
function isPrivateIP(ip) {
    const parts = ip.split('.').map(Number);

    // 10.0.0.0 - 10.255.255.255
    if (parts[0] === 10) return true;

    // 172.16.0.0 - 172.31.255.255
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

    // 192.168.0.0 - 192.168.255.255
    if (parts[0] === 192 && parts[1] === 168) return true;

    // 127.0.0.0 - 127.255.255.255 (回环地址)
    if (parts[0] === 127) return true;

    return false;
}
