'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Doc {
    path: string;
    title: string;
    type: string;
    modified: string;
}

interface UserDocs {
    username: string;
    docs: Doc[];
}

export default function Home() {
    const [users, setUsers] = useState<UserDocs[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // SSE 实时更新
        const es = new EventSource('/api/events');
        es.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.event === 'update') {
                loadUsers();
            }
        };

        loadUsers();
        return () => es.close();
    }, []);

    async function loadUsers() {
        try {
            const res = await fetch('/api/users');
            if (res.ok) {
                const data = await res.json();
                setUsers(data);
            }
        } catch (e) {
            console.error('Failed to load users:', e);
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

    return (
        <main className="max-w-4xl mx-auto p-8">
            <h1 className="text-3xl font-bold mb-6">PKGM 文档中心</h1>
            {users.length === 0 ? (
                <p className="text-gray-500">暂无文档，请先创建用户。</p>
            ) : (
                users.map(({ username, docs }) => (
                    <section key={username} className="mb-8">
                        <h2 className="text-xl font-semibold mb-3 text-blue-700">
                            {username}
                        </h2>
                        {docs.length === 0 ? (
                            <p className="text-gray-400 ml-4">暂无文档</p>
                        ) : (
                            <div className="space-y-2">
                                {docs.map((doc) => (
                                    <Link
                                        key={doc.path}
                                        href={`/docs/${username}?path=${encodeURIComponent(doc.path)}`}
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
                    </section>
                ))
            )}
        </main>
    );
}
