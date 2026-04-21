'use client';

import { useParams } from 'next/navigation';

export default function TestPathPage() {
    const params = useParams();
    return (
        <div style={{padding: '20px'}}>
            <h1>Test Path Page</h1>
            <pre>{JSON.stringify(params, null, 2)}</pre>
        </div>
    );
}
