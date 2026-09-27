import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportPanel } from '../panels/ImportPanel.js';
import { useModelingStore, undoStack } from '../../store/modelingStore.js';
import { useProjectStore, createInitialProject } from '../../store/projectStore.js';
import { HOUSE_TEMPLATES } from '../../core/templates.js';

beforeEach(() => {
  undoStack.clear();
  useModelingStore.setState({
    selectedTemplateId: null,
    model: structuredClone(HOUSE_TEMPLATES[0]!.model),
    pendingVertices: [],
    pendingRoomName: '房间',
    gridSnap: true,
    orthoSnap: true,
    isDrawing: false,
    importedImage: null,
    importImageName: null,
    calibrationPoints: [],
    isCalibrating: false,
    calibrationError: null,
  });
  useProjectStore.setState({ project: createInitialProject() });
});

describe('ImportPanel', () => {
  it('renders upload area when no image loaded', () => {
    render(<ImportPanel />);
    expect(screen.getByText('上传户型图')).toBeDefined();
    expect(screen.getByText(/点击或拖拽上传/)).toBeDefined();
  });

  it('renders SLA notice', () => {
    render(<ImportPanel />);
    expect(screen.getByText(/扫描图路径/)).toBeDefined();
  });

  it('shows clear button when image loaded', () => {
    useModelingStore.setState({ importedImage: {} as unknown as ImageBitmap });
    render(<ImportPanel />);
    expect(screen.getByText('清除')).toBeDefined();
  });

  it('shows calibration error message when set', () => {
    useModelingStore.setState({ importedImage: {} as unknown as ImageBitmap, calibrationError: '标定距离超出合理范围' });
    render(<ImportPanel />);
    expect(screen.getByText(/标定距离超出合理范围/)).toBeDefined();
  });

  it('clearImport resets state', () => {
    useModelingStore.setState({
      importedImage: {} as unknown as ImageBitmap,
      isCalibrating: true,
      calibrationPoints: [[10, 10], [20, 20]],
      calibrationError: 'error',
    });
    render(<ImportPanel />);
    fireEvent.click(screen.getByText('清除'));
    const s = useModelingStore.getState();
    expect(s.importedImage).toBeNull();
    expect(s.isCalibrating).toBe(false);
    expect(s.calibrationPoints).toHaveLength(0);
    expect(s.calibrationError).toBeNull();
  });

  it('addCalibrationPoint adds up to 2 points max', () => {
    const s = useModelingStore.getState();
    s.addCalibrationPoint(10, 10);
    s.addCalibrationPoint(20, 20);
    s.addCalibrationPoint(30, 30);
    expect(useModelingStore.getState().calibrationPoints).toHaveLength(2);
  });

  it('resetCalibration clears points and error', () => {
    const s = useModelingStore.getState();
    s.addCalibrationPoint(10, 10);
    s.addCalibrationPoint(20, 20);
    s.resetCalibration();
    expect(useModelingStore.getState().calibrationPoints).toHaveLength(0);
    expect(useModelingStore.getState().calibrationError).toBeNull();
  });
});
