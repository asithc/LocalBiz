import { Modal } from './Modal';

interface PdfPreviewModalProps {
  open: boolean;
  title: string;
  dataUrl: string;
  onClose: () => void;
}

export const PdfPreviewModal = ({ open, title, dataUrl, onClose }: PdfPreviewModalProps) => {
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-6xl">
      {!dataUrl ? (
        <div className="py-8 text-center text-slate-500">Loading preview...</div>
      ) : (
        <iframe title={title} src={dataUrl} className="h-[78vh] w-full rounded-md border border-slate-200" />
      )}
    </Modal>
  );
};
