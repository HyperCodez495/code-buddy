#pragma once

#include "CoreMinimal.h"

struct CODEBUDDYAVATAR_API FCodeBuddyWavData
{
    int32 SampleRate = 0;
    int32 NumChannels = 0;
    int32 BitsPerSample = 0;
    float DurationSeconds = 0.0f;
    TArray<uint8> PcmData;
};

/** Strict RIFF/WAVE PCM parser used before bytes reach Unreal's audio thread. */
class CODEBUDDYAVATAR_API FCodeBuddyWavParser
{
public:
    static bool ParsePcm16(
        const TArray<uint8>& Bytes,
        FCodeBuddyWavData& OutWav,
        FString& OutError);
};
