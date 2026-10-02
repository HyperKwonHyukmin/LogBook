import { Box } from 'lucide-react';
import Spinner from '../ui/Spinner.jsx';

/** 3D 로 볼 수 없을 때의 안내 상자(FilePreview 의 대체 상자와 같은 모양, 내려받기는 위 동작 줄이 맡는다). */
export default function ModelNote({ children, title, busy = false, action }) {
  return (
    <div className="flex flex-col items-center rounded-md bg-n-50 px-6 py-8 text-center">
      {busy ? <Spinner size={16} className="text-n-400" />
        : <Box size={20} strokeWidth={1.75} className="text-n-400" aria-hidden="true" />}
      <p role={busy ? 'status' : undefined} title={title} className="mt-3 max-w-[440px] text-ui text-n-600">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
