'use client';

import { useState } from 'react';

interface ImportResult {
  success: boolean;
  sourceDevice?: string;
  sourceDeviceId?: string;
  keypairsUpdated?: boolean;
  previousKeypairsMerged?: number;
  rotationHistoryMerged?: number;
  conflictsResolved?: number;
  error?: string;
}

interface ImportFlowProps {
  onSuccess?: (result: ImportResult) => void;
  onCancel?: () => void;
}

type ImportStep = 'select-file' | 'password' | 'importing' | 'success' | 'error';

export default function ImportFlow({ onSuccess, onCancel }: ImportFlowProps) {
  const [step, setStep] = useState<ImportStep>('select-file');
  const [filePath, setFilePath] = useState('');
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    if (!filePath || !password) return;

    setStep('importing');
    setError(null);

    try {
      if (!window.onestar?.sync?.importKeystore) {
        throw new Error('Import API not available');
      }

      const importResult = await window.onestar.sync.importKeystore(
        filePath,
        password
      );

      if (importResult.success) {
        setResult(importResult);
        setStep('success');
        onSuccess?.(importResult);
      } else {
        setError(importResult.error || 'Import failed');
        setStep('error');
      }
    } catch (err) {
      console.error('Import error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStep('error');
    }
  }

  function handleReset() {
    setStep('select-file');
    setFilePath('');
    setPassword('');
    setResult(null);
    setError(null);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setFilePath(file.path || file.name);
      setStep('password');
    }
  }

  // File selection step
  if (step === 'select-file') {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-md mx-auto">
        <h2 className="text-xl font-bold mb-4">Import Keystore</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Export File
            </label>
            <input
              type="file"
              accept=".json.enc,.enc"
              onChange={handleFileSelect}
              className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            <p className="text-xs text-gray-500 mt-2">
              Expected format: onestar-keystore-export-v1-*.json.enc
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded p-3">
            <p className="text-sm text-blue-800">
              <strong>ℹ️ Before importing:</strong>
            </p>
            <ul className="text-sm text-blue-700 mt-2 space-y-1 ml-4 list-disc">
              <li>Ensure the export file is from a trusted source</li>
              <li>Have the export password ready</li>
              <li>Your vault must be unlocked</li>
            </ul>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Password entry step
  if (step === 'password') {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-md mx-auto">
        <h2 className="text-xl font-bold mb-4">Enter Export Password</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Selected File
            </label>
            <p className="text-sm font-mono bg-gray-50 p-2 rounded border break-all">
              {filePath}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Export Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && password && handleImport()}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              placeholder="Enter the export password"
              autoFocus
            />
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
            <p className="text-sm text-yellow-800">
              <strong>⚠️ Security Checks:</strong>
            </p>
            <ul className="text-sm text-yellow-700 mt-2 space-y-1 ml-4 list-disc">
              <li>HMAC signature validation</li>
              <li>Rotation chain integrity</li>
              <li>Downgrade attack detection</li>
              <li>Replay attack detection</li>
            </ul>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleImport}
              disabled={!password}
              className={`flex-1 px-4 py-2 rounded font-medium ${
                password
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              Import & Merge
            </button>
            <button
              onClick={() => setStep('select-file')}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              Back
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Importing state
  if (step === 'importing') {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-md mx-auto text-center">
        <div className="mb-4">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
        </div>
        <h2 className="text-xl font-bold mb-2">Importing Keystore</h2>
        <div className="space-y-2 text-sm text-gray-600">
          <p>⏳ Decrypting with AES-256-GCM...</p>
          <p>🔍 Verifying HMAC signature...</p>
          <p>🔗 Validating rotation chain...</p>
          <p>🔄 Merging keystores...</p>
        </div>
        <p className="text-sm text-gray-500 mt-4">
          This may take a few seconds
        </p>
      </div>
    );
  }

  // Success state
  if (step === 'success' && result) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-md mx-auto">
        <div className="text-center mb-4">
          <div className="inline-block p-3 bg-green-100 rounded-full mb-3">
            <span className="text-4xl">✅</span>
          </div>
          <h2 className="text-xl font-bold text-green-800">Import Successful</h2>
        </div>

        <div className="space-y-3 bg-gray-50 rounded p-4 mb-4">
          <div>
            <p className="text-sm text-gray-500">Source Device</p>
            <p className="font-medium">{result.sourceDevice || 'Unknown'}</p>
            <p className="font-mono text-xs text-gray-500">
              {result.sourceDeviceId?.slice(0, 16)}...
            </p>
          </div>
          
          <div className="grid grid-cols-2 gap-4 pt-3 border-t">
            <div>
              <p className="text-sm text-gray-500">Keypairs Updated</p>
              <p className="font-medium">{result.keypairsUpdated ? 'Yes' : 'No'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Conflicts Resolved</p>
              <p className="font-medium">{result.conflictsResolved || 0}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Previous Keypairs</p>
              <p className="font-medium">+{result.previousKeypairsMerged || 0}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Rotation History</p>
              <p className="font-medium">+{result.rotationHistoryMerged || 0}</p>
            </div>
          </div>
        </div>

        {result.keypairsUpdated && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
            <p className="text-sm text-yellow-800">
              <strong>⚡ Current keypair updated:</strong> Your device now uses the newer keypair from {result.sourceDevice}.
            </p>
          </div>
        )}

        <div className="bg-green-50 border border-green-200 rounded p-3 mb-4">
          <p className="text-sm text-green-800">
            <strong>✓ Sync Complete:</strong> Your devices are now in sync!
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleReset}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Import Another
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (step === 'error') {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-md mx-auto">
        <div className="text-center mb-4">
          <div className="inline-block p-3 bg-red-100 rounded-full mb-3">
            <span className="text-4xl">❌</span>
          </div>
          <h2 className="text-xl font-bold text-red-800">Import Failed</h2>
        </div>

        <div className="bg-red-50 border border-red-200 rounded p-4 mb-4">
          <p className="text-sm text-red-800 font-semibold mb-1">Error Details:</p>
          <p className="text-sm text-red-700">{error}</p>
        </div>

        {/* Specific error guidance */}
        {error?.includes('password') && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
            <p className="text-sm text-blue-800">
              <strong>💡 Password incorrect?</strong> Make sure you're using the password that was set during export.
            </p>
          </div>
        )}

        {error?.includes('Identity mismatch') && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
            <p className="text-sm text-yellow-800">
              <strong>⚠️ Identity mismatch:</strong> This export is from a different user account and cannot be imported.
            </p>
          </div>
        )}

        {error?.includes('Downgrade attack') && (
          <div className="bg-red-50 border border-red-300 rounded p-3 mb-4">
            <p className="text-sm text-red-800">
              <strong>🚨 Security Alert:</strong> This export appears to be from an older device or may be malicious. Import blocked.
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleReset}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Try Again
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return null;
}
