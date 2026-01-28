/**
 * Custom MindMap Node Component for React Flow
 * Displays node topic, content indicator, and collapse/expand toggle
 */
import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { MindMapNodeData } from './layoutUtils';

function MindMapNodeComponent(props: NodeProps) {
    const { id, data, selected, style } = props as any;
    // Cast data with proper type
    const nodeData = data as MindMapNodeData;

    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(nodeData.topic);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            // Use setTimeout to ensure focus happens after any potential 
            // layout updates or other focus events (like from React Flow)
            setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 10);
        }
    }, [isEditing]);

    const lastEditTsRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        if (nodeData.startEditTs && nodeData.startEditTs !== lastEditTsRef.current) {
            lastEditTsRef.current = nodeData.startEditTs;
            setIsEditing(true);
        }
    }, [nodeData.startEditTs]);

    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!nodeData.isImage) {
            setEditValue(nodeData.topic);
            setIsEditing(true);
        }
    }, [nodeData.isImage, nodeData.topic]);

    const handleBlur = useCallback(() => {
        if (isEditing && editValue.trim() !== nodeData.topic) {
            nodeData.onNodeRename?.(id, editValue.trim());
        }
        setIsEditing(false);
    }, [isEditing, editValue, nodeData, id]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // Prevent duplicate newlines or form submit
            e.nativeEvent.stopImmediatePropagation(); // Stop native bubbling to document
            e.stopPropagation(); // Stop React bubbling
            handleBlur();
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            setEditValue(nodeData.topic);
            setIsEditing(false);
        }
    }, [handleBlur, nodeData.topic]);

    const handleToggleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        nodeData.onToggleExpand?.(id);
    }, [id, nodeData]);

    const nodeClass = `mindmap-node ${nodeData.isRoot ? 'mindmap-node-root' : ''} ${selected ? 'mindmap-node-selected' : ''} ${nodeData.isDragging ? 'mindmap-node-dragging' : ''} ${nodeData.dropZone === 'above' ? 'mindmap-drop-above' : ''} ${nodeData.dropZone === 'child' ? 'mindmap-drop-child' : ''} ${nodeData.dropZone === 'below' ? 'mindmap-drop-below' : ''}`.trim();

    return (
        <div className={nodeClass} style={style} onDoubleClick={handleDoubleClick}>
            {/* Input handle (left side) */}
            {!nodeData.isRoot && (
                <Handle
                    type="target"
                    position={Position.Left}
                    className="mindmap-handle"
                />
            )}

            {/* Node content */}
            <div className="mindmap-node-content">
                {/* Content indicator */}
                {nodeData.hasContent && !nodeData.isImage && (
                    <span className="mindmap-content-indicator" title="Has content">
                        📝
                    </span>
                )}

                {/* Topic text or image */}
                {isEditing ? (
                    <input
                        ref={inputRef}
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        className="mindmap-node-input nodrag"
                    />
                ) : nodeData.isImage && nodeData.imageUrl ? (
                    <img
                        src={nodeData.imageUrl as string}
                        alt="Node image"
                        className="mindmap-node-image"
                    />
                ) : (
                    <span className="mindmap-node-topic">{nodeData.topic}</span>
                )}

            </div>

            {/* Collapse/expand toggle */}
            {nodeData.hasChildren && (
                <button
                    className="mindmap-toggle-btn"
                    onClick={handleToggleClick}
                    aria-label={nodeData.expanded ? 'Collapse' : 'Expand'}
                >
                    {nodeData.expanded ? '−' : '+'}
                </button>
            )}

            {/* Output handle (right side) */}
            <Handle
                type="source"
                position={Position.Right}
                className="mindmap-handle"
            />
        </div>
    );
}

export const MindMapNode = memo(MindMapNodeComponent);
