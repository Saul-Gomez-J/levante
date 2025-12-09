import { useState } from 'react';
import { StoreLayout } from '@/components/mcp/store-page/store-layout';
import { Toaster } from 'sonner';

type ViewMode = 'active' | 'store';

const StorePage = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('active');

  return (
    <div className="h-full overflow-y-auto">
      <StoreLayout mode={viewMode} onModeChange={setViewMode} />
      <Toaster position="top-right" />
    </div>
  )
}

export default StorePage