/**
 * PKGM-Web Markdown 渲染
 *
 * 统一 remark 链，前端唯一渲染源。
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';

export const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeKatex)
    .use(rehypeRaw)
    .use(rehypeStringify);

export async function renderMarkdown(content: string): Promise<string> {
    return String(await processor.process(content));
}
