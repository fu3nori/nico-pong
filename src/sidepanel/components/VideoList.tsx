import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { NicoPongTab, NicoPongVideo } from "../../shared/types";
import VideoCard from "./VideoCard";

type Props = {
  tab: NicoPongTab;
  videos: NicoPongVideo[];
  currentVideoInternalId?: string;
  onDelete: (tab: NicoPongTab, id: string) => void;
  onUpdate: (tab: NicoPongTab, video: NicoPongVideo) => void;
  onReorder: (tab: NicoPongTab, idsInOrder: string[]) => void;
  onForcePlay: (tab: NicoPongTab, video: NicoPongVideo) => void;
  onCopyToRequest?: (tab: NicoPongTab, video: NicoPongVideo) => void;
  onMoveToRequest?: (tab: NicoPongTab, video: NicoPongVideo) => void;
};

export default function VideoList({
  tab,
  videos,
  currentVideoInternalId,
  onDelete,
  onUpdate,
  onReorder,
  onForcePlay,
  onCopyToRequest,
  onMoveToRequest,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = videos.findIndex((v) => v.id === active.id);
    const newIndex = videos.findIndex((v) => v.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const nextIds = arrayMove(videos, oldIndex, newIndex).map((v) => v.id);
    onReorder(tab, nextIds);
  }

  if (videos.length === 0) {
    return (
      <div className="empty">
        {tab === "request"
          ? "リクエストはまだありません。動画ID/URLを入力して追加してください。"
          : "ストックはまだありません。動画ID/URLを入力して追加してください。"}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={videos.map((v) => v.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="list">
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              tab={tab}
              video={video}
              isCurrent={currentVideoInternalId === video.id}
              onDelete={(id) => onDelete(tab, id)}
              onUpdate={(v) => onUpdate(tab, v)}
              onForcePlay={(v) => onForcePlay(tab, v)}
              onCopyToRequest={
                onCopyToRequest ? (v) => onCopyToRequest(tab, v) : undefined
              }
              onMoveToRequest={
                onMoveToRequest ? (v) => onMoveToRequest(tab, v) : undefined
              }
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
