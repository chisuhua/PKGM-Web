import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // 输出独立可执行文件（Docker 部署用）
    output: 'standalone',

    // 环境变量默认值
    env: {
        PKGM_USERS_DIR: process.env.PKGM_USERS_DIR || '/workspace/project/PKGM/users',
        WEB_PORT: process.env.WEB_PORT || '3001',
    },
};

export default nextConfig;
