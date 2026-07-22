import { X, ArrowLeft } from "lucide-react";
import "./scss/Modal.scss";

type Props = {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
};

export default function Modal({ title, onClose, onBack, children, size = "md" }: Props) {
  return (
    <div className="modal__backdrop" onClick={onClose}>
      <div
        className={`modal${size !== "md" ? ` modal--${size}` : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          {onBack && (
            <button className="modal__header__back" onClick={onBack} title="Back">
              <ArrowLeft size={15} />
            </button>
          )}
          <span className="modal__header__title">{title}</span>
          <button className="modal__header__close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
