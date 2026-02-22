import { Box } from '@mui/material';
import { useRef, useCallback } from 'react';

interface DividerProps {
  onDrag: (newWidth: number) => void;
  currentWidth: number;
  containerWidth: number;
  minWidth: number;
  maxWidthPercent: number;
}

function Divider({ onDrag, currentWidth, containerWidth, minWidth, maxWidthPercent }: DividerProps) {
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = currentWidth + (moveEvent.clientX - e.clientX);
      const maxPercent = maxWidthPercent;
      const minPercent = minWidth / containerWidth;
      const newPercent = newWidth / containerWidth;

      if (newPercent >= minPercent && newPercent <= maxPercent) {
        onDrag(newWidth);
      }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [currentWidth, containerWidth, minWidth, maxWidthPercent, onDrag]);

  return (
    <Box
      sx={{
        width: '8px',
        cursor: 'col-resize',
        backgroundColor: 'divider',
        '&:hover': {
          backgroundColor: 'primary.main',
        },
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      onMouseDown={handleMouseDown}
    >
      <Box
        sx={{
          width: '2px',
          height: '40px',
          backgroundColor: 'text.secondary',
          borderRadius: '1px',
          opacity: 0.5,
        }}
      />
    </Box>
  );
}

export default Divider;
