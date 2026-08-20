/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useEffect, useMemo, useRef, useState } from 'react';
import CardTable from './CardTable';
import { useIsMobile } from '../../../hooks/common/useIsMobile';

const MIN_COLUMN_WIDTH = 60;

const LightweightResizableCardTable = ({ columns = [], ...tableProps }) => {
  const isMobile = useIsMobile();
  const containerRef = useRef(null);
  const indicatorRef = useRef(null);
  const dragCleanupRef = useRef(null);
  const [columnWidths, setColumnWidths] = useState({});

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  const resizableColumns = useMemo(() => {
    if (isMobile) return columns;

    return columns.map((column, index) => {
      const columnKey = column.key ?? column.dataIndex ?? index;
      const width = columnWidths[columnKey] ?? column.width;

      return {
        ...column,
        ...(width === undefined ? {} : { width }),
        title: (
          <div style={{ position: 'relative', width: '100%' }}>
            {column.title}
            <span
              role='separator'
              aria-orientation='vertical'
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();

                const headerCell = event.currentTarget.closest('th');
                const container = containerRef.current;
                const indicator = indicatorRef.current;
                if (!headerCell || !container || !indicator) return;

                dragCleanupRef.current?.();

                const startX = event.clientX;
                const startWidth = headerCell.getBoundingClientRect().width;
                const startRight =
                  headerCell.getBoundingClientRect().right -
                  container.getBoundingClientRect().left;
                let nextWidth = startWidth;

                indicator.style.display = 'block';
                indicator.style.left = `${startRight}px`;

                const handleMouseMove = (moveEvent) => {
                  nextWidth = Math.max(
                    MIN_COLUMN_WIDTH,
                    startWidth + moveEvent.clientX - startX,
                  );
                  indicator.style.left = `${startRight + nextWidth - startWidth}px`;
                };

                const cleanup = () => {
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                  indicator.style.display = 'none';
                  dragCleanupRef.current = null;
                };

                const handleMouseUp = () => {
                  cleanup();
                  if (Math.round(nextWidth) !== Math.round(startWidth)) {
                    setColumnWidths((current) => ({
                      ...current,
                      [columnKey]: Math.round(nextWidth),
                    }));
                  }
                };

                dragCleanupRef.current = cleanup;
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
              style={{
                position: 'absolute',
                top: -12,
                right: -8,
                bottom: -12,
                width: 16,
                cursor: 'col-resize',
                userSelect: 'none',
              }}
            />
          </div>
        ),
      };
    });
  }, [columns, columnWidths, isMobile]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <CardTable columns={resizableColumns} {...tableProps} />
      {!isMobile && (
        <div
          ref={indicatorRef}
          style={{
            display: 'none',
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: 2,
            background: 'var(--semi-color-primary)',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
};

export default LightweightResizableCardTable;
