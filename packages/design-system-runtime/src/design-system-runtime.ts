export { AuditWrapper } from './components/AuditWrapper';
export { SelectionBox } from './components/SelectionBox';
export { usePostMessage } from './hooks/usePostMessage';

export type { AuditWrapperProps, SelectionBoxProps } from './components/types';
export type {
  PostMessageConfig,
  IframeMessage,
  IframeToParentMessage,
  ParentToIframeMessage,
  ComponentSelectedMessage,
  ErrorMessage,
  SetModeMessage,
  HighlightComponentMessage,
} from './hooks/usePostMessage';
