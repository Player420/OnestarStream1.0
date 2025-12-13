'use client';

import { useState } from 'react';

interface ExportResult {
  success: boolean;
  filePath?: string;
  fileSize?: number;
  exportedAt?: number;
  error?: string;
}

interface ExportFlowProps {
  onSuccess?: (result: ExportResult) => void;
  onCancel?: () => void;
}

type ExportStep = 'password' | 'biometric' | 'exporting' | 'success' | 'error';

export default function ExportFlow({ onSuccess, onCancel }: ExportFlowProps) {
  const [step, setStep] = useState<ExportStep>('password');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const passwordsMatch = password === confirmPassword;
  const passwordValid = password.length >= 12;
  const canExport = passwordValid && passwordsMatch && password.length > 0;

  async function handleExport() {
    if (!canExport) return;

    setStep('exporting');
    setError(null);

    try {
      if (!window.onestar?.sync?.exportKeystore) {
        throw new Error('Export API not available');
      }

      const exportResult = await window.onestar.sync.exportKeystore(
        password,
        confirmPassword,
        outputPath || undefined
      );

      if (exportResult.success) {
        setResult(exportResult);
        setStep('success');
        onSuccess?.(exportResult);
      } else {
        setError(exportResult.error || 'Export failed');
        setStep('error');
      }
    } catch (err) {
      console.error('Export error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStep('error');
    }
  }

  function handleReset() {
    setStep('password');
    setPassword('');
    setConfirmPassword('');
    setOutputPath('');
    setResult(null);
    setError(null);
  }

  function formatFileSize(bytes?: number): string {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  // Password entry step
  if (step === 'password') {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-md mx-auto">
        <h2 className="text-xl font-bold mb-4">Export Keystore</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Export Password (min 12 characters)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              placeholder="Enter strong password"
              autoFocus
            />
            {password.length > 0 && !passwordValid && (
              <p className="text-xs text-red-600 mt-1">
                Password must be at least 12 characters
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              placeholder="Re-enter password"
            />
            {confirmPassword.length > 0 && !passwordsMatch && (
              <p className="text-xs text-red-600 mt-1">
                Passwords do not match
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Export Location (optional)
            </label>
            <input
              type="text"
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              placeholder="Leave empty for default (Downloads)"
            />
            <p className="text-xs text-gray-500 mt-1">
              Default: Downloads/onestar-keystore-export-v1-*.json.enc
            </p>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
            <p className="text-sm text-yellow-800">
              <strong>⚠️ Security Warning:</strong> This password protects your exported keystore.
              Choose a strong, unique password. Store it securely.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleExport}
              disabled={!canExport}
              className={`flex-1 px-4 py-2 rounded font-medium ${
                canExport
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              Export Keystore
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

  // Exporting state
  if (step === 'exporting') {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-md mx-auto text-center">
        <div className="mb-4">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
        <h2 className="text-xl font-bold mb-2">Exporting Keystore</h2>
        <p className="text-gray-600">
          Encrypting your keystore with AES-256-GCM...
        </p>
        <p className="text-sm text-gray-500 mt-2">
          This may take a few seconds (PBKDF2 100k iterations)
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
          <h2 className="text-xl font-bold text-green-800">Export Successful</h2>
        </div>

        <div className="space-y-3 bg-gray-50 rounded p-4 mb-4">
          <div>
            <p className="text-sm text-gray-500">Export File</p>
            <p className="font-mono text-xs break-all">{result.filePath}</p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">File Size</p>
              <p className="font-medium">{formatFileSize(result.fileSize)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Exported At</p>
              <p className="font-medium text-sm">
                {result.exportedAt ? new Date(result.exportedAt).toLocaleString() : 'N/A'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
          <p className="text-sm text-blue-800">
            <strong>📦 Next Steps:</strong>
          </p>
          <ol className="text-sm text-blue-700 mt-2 space-y-1 ml-4 list-decimal">
            <li>Transfer the export file to your other device (USB, AirDrop, etc.)</li>
            <li>Open OneStar on the other device</li>
            <li>Go to Settings → Sync → Import Keystore</li>
            <li>Select the export file and enter the password</li>
          </ol>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleReset}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Export Another
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
          <h2 className="text-xl font-bold text-red-800">Export Failed</h2>
        </div>

        <div className="bg-red-50 border border-red-200 rounded p-4 mb-4">
          <p className="text-sm text-red-800 font-semibold mb-1">Error Details:</p>
          <p className="text-sm text-red-700">{error}</p>
        </div>

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
