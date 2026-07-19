import React, { useState, useEffect, useRef } from 'react';
import { StreamController } from '../../lib/streaming/StreamController';
import { StepsSidebar } from './StepsSidebar';
import { ArtifactPanel } from './ArtifactPanel';
import { API } from '../../context/AppContext';

export function useStreamController() {
  const controller = useRef(new StreamController(`${API}/generate`));
  const [uiState, setUiState] = useState(controller.current.state);

  useEffect(() => {
    // Special chat renamed callback
    controller.current.onChatRenamed = (data) => {
        // We'll handle this in the parent
    };
    return controller.current.subscribe(setUiState);
  }, []);

  return { controller: controller.current, uiState };
}
