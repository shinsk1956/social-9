import React, { useCallback } from 'react';

interface DropzoneProps {
  label: string;
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  colorClass?: string;
  icon?: React.ReactNode;
}

const Dropzone: React.FC<DropzoneProps> = ({ 
  label, 
  onFilesSelected, 
  accept = "image/*,application/pdf",
  colorClass = "border-indigo-300 bg-indigo-50 text-indigo-600",
  icon
}) => {
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onFilesSelected(Array.from(e.dataTransfer.files));
      }
    },
    [onFilesSelected]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(Array.from(e.target.files));
    }
  };

  return (
    <div
      className={`relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer hover:bg-opacity-70 transition-colors ${colorClass}`}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center px-4">
        <div className="mb-3 text-3xl">
            {icon || (
                <svg className="w-8 h-8 mb-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16">
                    <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"/>
                </svg>
            )}
        </div>
        <p className="mb-2 text-sm font-semibold">
          <span className="font-bold">{label}</span>
        </p>
        <p className="text-xs opacity-75">PDF, PNG, JPG (Click or Drag)</p>
      </div>
      <input 
        type="file" 
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
        onChange={handleChange} 
        accept={accept}
        multiple 
      />
    </div>
  );
};

export default Dropzone;
