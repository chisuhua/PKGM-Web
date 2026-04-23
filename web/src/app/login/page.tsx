'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Login() {
    const [username, setUsername] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!username.trim()) {
            setError('Please enter username');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username.trim() })
            });
            const data = await res.json();

            if (data.success) {
                router.push('/');
            } else {
                setError(data.error || 'Login failed');
            }
        } catch {
            setError('Network error');
        } finally {
            setLoading(false);
        }
    }

    return (
        <main style={{ maxWidth: 400, margin: '100px auto', padding: 20, textAlign: 'center' }}>
            <h1 style={{ fontSize: 24, marginBottom: 30 }}>PKGM Login</h1>
            <form onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="Username"
                    style={{
                        width: '100%',
                        padding: '12px 16px',
                        fontSize: 16,
                        border: '1px solid #ccc',
                        borderRadius: 6,
                        marginBottom: 16,
                        boxSizing: 'border-box'
                    }}
                    disabled={loading}
                />
                <button
                    type="submit"
                    disabled={loading}
                    style={{
                        width: '100%',
                        padding: '12px 16px',
                        fontSize: 16,
                        backgroundColor: '#0070f3',
                        color: 'white',
                        border: 'none',
                        borderRadius: 6,
                        cursor: loading ? 'not-allowed' : 'pointer',
                        opacity: loading ? 0.7 : 1
                    }}
                >
                    {loading ? 'Logging in...' : 'Login'}
                </button>
            </form>
            {error && (
                <p style={{ color: 'red', marginTop: 16 }}>{error}</p>
            )}
        </main>
    );
}