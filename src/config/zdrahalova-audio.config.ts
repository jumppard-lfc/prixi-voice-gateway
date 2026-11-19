export const zdrahalovaAudioFiles = {
  greeting: 'zdrahalova-01-greeting-v1.wav',
  completion: 'zdrahalova-02-completion-v1.wav',
  afterHours: 'zdrahalova-03-after-hours-v1.wav',
  vacation: 'zdrahalova-04-vacation-v1.wav',
  technicalError: 'zdrahalova-05-technical-error-v1.wav',
  unavailable: 'zdrahalova-06-unavailable-v1.wav',
} as const;

export type ZdrahalovaAudioKey = keyof typeof zdrahalovaAudioFiles;

export const zdrahalovaAudioFileNames = Object.values(zdrahalovaAudioFiles);
