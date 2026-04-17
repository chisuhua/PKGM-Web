import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'PKGM 文档中心',
    description: 'Personal Knowledge Graph Manager - AI 文档中心',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="zh-CN">
            <body className="min-h-screen bg-gray-50">{children}</body>
        </html>
    );
}
