'use client';

import { useParams } from 'next/navigation';

export default function TestCatchPage() {
    const params = useParams();
    return (
        <div style={{padding: '20px'}}>
            <h1>Test Catch-All</h1>
            <pre>{JSON.stringify(params, null, 2)}</pre>
        </div>
    );
}
