'use client';

import { useEffect, useState, use } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface Doc {
    path: string;
    title: string;
    content: string;
    type: string;
    modified: string;
    status: string;
}

interface Props {
    params: Promise<{ user: string }>;
}

export default function DocPage({ params }: Props) {
    const { user } = use(params);
    const searchParams = useSearchParams();
    const docPath = searchParams.get('path') || '';

    const [doc, setDoc] = useState<Doc | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!docPath) {
            setLoading(false);
            return;
        }

        fetch(`/api/doc?user=${encodeURIComponent(user)}&path=${encodeURIComponent(docPath)}`)
            .then(r => r.json())
            .then(d => setDoc(d))
            .finally(() => setLoading(false));
    }, [user, docPath]);

    if (loading) return <div className="p-8">加载中...</div>;
    if (!doc) return <div className="p-8">文档未找到</div>;

    return (
        <div className="max-w-4xl mx-auto p-8">
            <div className="mb-4">
                <Link href="/" className="text-blue-600 hover:underline">← 返回列表</Link>
            </div>
            <article className="prose prose-slate max-w-none">
                <header className="mb-6 border-b pb-4">
                    <h1 className="text-3xl font-bold mb-2">{doc.title || '无标题'}</h1>
                    <div className="flex gap-4 text-sm text-gray-500">
                        <span>类型：{doc.type}</span>
                        <span>状态：{doc.status}</span>
                        <span>修改：{new Date(doc.modified).toLocaleString('zh-CN')}</span>
                    </div>
                </header>
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath, rehypeKatex, rehypeRaw]}
                >
                    {doc.content}
                </ReactMarkdown>
            </article>
        </div>
    );
}
