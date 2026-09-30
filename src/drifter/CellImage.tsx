import { useState } from 'react';
import { blobUrl } from './api';
import type { StoryCell } from './types';

export default function CellImage({ cell, thumbnail = false }: { cell: StoryCell; thumbnail?: boolean }) {
  const [dimensions, setDimensions] = useState({ width: cell.pixelWidth ?? 0, height: cell.pixelHeight ?? 0 });
  if (!cell.imageHash) return <div className={`image-missing ${thumbnail ? 'small' : ''}`}><span>＋</span><p>{cell.role === 'START' ? 'Starting image needed' : 'Image needed'}</p></div>;
  const crop = cell.crop;
  const cropped = crop && dimensions.width && dimensions.height;
  return <div className="cell-image" style={crop ? { aspectRatio: `${crop.width} / ${crop.height}` } : undefined}>
    <img src={blobUrl(cell.imageHash)} alt={thumbnail ? '' : cell.description} draggable={false}
      onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      style={cropped ? { position: 'absolute', maxWidth: 'none', width: `${dimensions.width / crop.width * 100}%`, height: `${dimensions.height / crop.height * 100}%`, left: `${-crop.x / crop.width * 100}%`, top: `${-crop.y / crop.height * 100}%` } : undefined} />
  </div>;
}

