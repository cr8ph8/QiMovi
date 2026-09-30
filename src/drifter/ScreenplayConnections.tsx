import { useId } from 'react';
import { buildScreenplayConnections, SCREENPLAY_CONNECTION_ACTION_LABELS, type ScreenplayConnection, type ScreenplayConnectionAction, type ScreenplayConnectionElement } from './screenplayConnectionsModel';
import './screenplay-connections.css';

export type { ScreenplayConnectionAction } from './screenplayConnectionsModel';
export type ScreenplayConnectionsProps = {
  element: ScreenplayConnectionElement;
  sourceLabel?: string;
  disabled?: boolean;
  onAction?: (action: ScreenplayConnectionAction) => void;
};

export default function ScreenplayConnections({ element, sourceLabel, disabled = false, onAction }: ScreenplayConnectionsProps) {
  const titleId = useId();
  const { reading, immediate, more } = buildScreenplayConnections(element);
  function row(item: ScreenplayConnection) {
    return <li key={`${item.action}:${item.title}`} className="scn-work-row">
      <div><strong>{item.title}</strong><p>{item.purpose}</p><small>{item.stage}</small></div>
      <button type="button" disabled={disabled || !onAction} onClick={() => { if (!disabled) onAction?.(item.action); }}>{SCREENPLAY_CONNECTION_ACTION_LABELS[item.action]}<span aria-hidden="true"> ↗</span></button>
    </li>;
  }
  return <section className="screenplay-connections" aria-labelledby={titleId} data-element-id={element.id}>
    <header><span className="scn-eyebrow">Production connections</span><h3 id={titleId} className="scn-heading">{reading.label}</h3>{sourceLabel && <p className="scn-source">{sourceLabel}<small> · {element.id}</small></p>}</header>
    <p className="scn-description">{reading.description}</p>
    {(reading.characterName || reading.extensions?.length || reading.sceneNumber) && <dl className="scn-metadata">
      {reading.characterName && <><dt>Cue name</dt><dd>{reading.characterName}</dd></>}
      {Boolean(reading.extensions?.length) && <><dt>Cue extensions</dt><dd>{reading.extensions!.join(' · ')}</dd></>}
      {reading.sceneNumber && <><dt>Printed scene no.</dt><dd>{reading.sceneNumber}</dd></>}
    </dl>}
    {reading.inferred && <p className="scn-inference">Suggested from the text. Confirm its purpose in the scene before planning.</p>}
    {immediate.length > 0 && <><ul className="scn-work-list" aria-label="Production tools for this element">{immediate.map(row)}</ul><p className="scn-boundary">These links open tools. Planning, generation and execution remain separate steps.</p></>}
    {more.length > 0 && <details className="scn-more"><summary>Further along the pipeline</summary><ul className="scn-work-list" aria-label="Further production uses">{more.map(row)}</ul></details>}
  </section>;
}
