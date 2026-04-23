'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Doc {
    path: string;
    title: string;
    type: string;
    modified: string;
}

interface UserData {
    username: string;
    docs: Doc[];
}

export default function Home() {
    const [userData, setUserData] = useState<UserData | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        loadCurrentUser();
    }, []);

    async function loadCurrentUser() {
        try {
            const res = await fetch('/api/users');
            if (res.status === 401) {
                router.push('/login');
                return;
            }
            if (res.ok) {
                const data = await res.json();
                setUserData(data);
            }
        } catch (e) {
            console.error('Failed to load:', e);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <main className="max-w-4xl mx-auto p-8">
                <h1 className="text-3xl font-bold mb-6">PKGM 文档中心</h1>
                <p className="text-gray-500">加载中...</p>
            </main>
        );
    }

    if (!userData) {
        return (
            <main className="max-w-4xl mx-auto p-8">
                <h1 className="text-3xl font-bold mb-6">PKGM 文档中心</h1>
                <p className="text-gray-500">请先登录</p>
                <Link href="/login" className="text-blue-500 hover:underline">去登录</Link>
            </main>
        );
    }

    return (
        <main className="max-w-4xl mx-auto p-8">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <h1 className="text-3xl font-bold">PKGM 文档中心</h1>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <span>欢迎, {userData.username}</span>
                    <form action="/api/logout" method="POST">
                        <button type="submit" style={{ color: '#666', cursor: 'pointer', background: 'none', border: 'none' }}>
                            退出
                        </button>
                    </form>
                </div>
            </div>
            {userData.docs.length === 0 ? (
                <p className="text-gray-500">暂无文档</p>
            ) : (
                <div className="space-y-2">
                    {userData.docs.map((doc) => (
                        <Link
                            key={doc.path}
                            href={`/docs/${userData.username}?path=${encodeURIComponent(doc.path)}`}
                            className="block p-4 border rounded hover:bg-gray-50 transition"
                        >
                            <div className="flex justify-between items-center">
                                <span className="font-medium">{doc.title || '无标题'}</span>
                                <span className="text-sm text-gray-400">{doc.type}</span>
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                                {new Date(doc.modified).toLocaleString('zh-CN')}
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </main>
    );
}
