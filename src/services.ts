// import request from './request'
import { request } from '@jupyterlab/services';
// import { message } from 'antd';
import * as path from 'path';

export function createJob({ projectId, type, scriptPath, env, displayName, onJson }) {
  return request(path.join('/pyapi', 'jobs'), {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      project_id: projectId,
      type,
      env,
      script_path: scriptPath,
      display_name: displayName,
    }),
  }, { onJson });
}
