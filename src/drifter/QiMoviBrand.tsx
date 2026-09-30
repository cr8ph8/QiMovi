import projectorMark from './brand/qimovi-projector.png';
import './qimovi-brand.css';

/** The Quotient Intelligent marks form the two reels of our studio projector. */
export default function QiMoviBrand() {
  return <span className="qimovi-brand" role="img" aria-label="QiMovi">
    <img src={projectorMark} alt="" aria-hidden="true" draggable={false}/>
    <span aria-hidden="true">QiMovi</span>
  </span>;
}
