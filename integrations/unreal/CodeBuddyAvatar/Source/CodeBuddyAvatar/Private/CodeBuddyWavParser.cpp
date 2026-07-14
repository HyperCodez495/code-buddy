#include "CodeBuddyWavParser.h"

namespace
{
uint16 ReadLe16(const uint8* Data)
{
    return static_cast<uint16>(Data[0]) |
        (static_cast<uint16>(Data[1]) << 8);
}

uint32 ReadLe32(const uint8* Data)
{
    return static_cast<uint32>(Data[0]) |
        (static_cast<uint32>(Data[1]) << 8) |
        (static_cast<uint32>(Data[2]) << 16) |
        (static_cast<uint32>(Data[3]) << 24);
}

bool IsFourCc(const uint8* Data, const char* Expected)
{
    return Data[0] == static_cast<uint8>(Expected[0]) &&
        Data[1] == static_cast<uint8>(Expected[1]) &&
        Data[2] == static_cast<uint8>(Expected[2]) &&
        Data[3] == static_cast<uint8>(Expected[3]);
}
}

bool FCodeBuddyWavParser::ParsePcm16(
    const TArray<uint8>& Bytes,
    FCodeBuddyWavData& OutWav,
    FString& OutError)
{
    OutWav = {};
    OutError.Reset();

    if (Bytes.Num() < 44 || !IsFourCc(Bytes.GetData(), "RIFF") ||
        !IsFourCc(Bytes.GetData() + 8, "WAVE"))
    {
        OutError = TEXT("Expected a complete RIFF/WAVE container.");
        return false;
    }

    const uint64 DeclaredRiffBytes = static_cast<uint64>(ReadLe32(Bytes.GetData() + 4)) + 8;
    if (DeclaredRiffBytes != static_cast<uint64>(Bytes.Num()))
    {
        OutError = TEXT("The RIFF size does not match the received byte count.");
        return false;
    }

    bool bFoundFormat = false;
    bool bFoundData = false;
    uint16 AudioFormat = 0;
    uint16 BlockAlign = 0;
    int32 Offset = 12;

    while (Offset + 8 <= Bytes.Num())
    {
        const uint8* Chunk = Bytes.GetData() + Offset;
        const uint32 ChunkSize = ReadLe32(Chunk + 4);
        const uint64 DataStart = static_cast<uint64>(Offset) + 8;
        const uint64 DataEnd = DataStart + ChunkSize;
        if (DataEnd > static_cast<uint64>(Bytes.Num()))
        {
            OutError = TEXT("A WAVE chunk is truncated.");
            return false;
        }

        if (IsFourCc(Chunk, "fmt "))
        {
            if (bFoundFormat)
            {
                OutError = TEXT("The WAVE container has duplicate fmt chunks.");
                return false;
            }
            if (ChunkSize < 16)
            {
                OutError = TEXT("The WAVE fmt chunk is too small.");
                return false;
            }
            const uint8* Format = Bytes.GetData() + DataStart;
            AudioFormat = ReadLe16(Format);
            OutWav.NumChannels = ReadLe16(Format + 2);
            OutWav.SampleRate = static_cast<int32>(ReadLe32(Format + 4));
            BlockAlign = ReadLe16(Format + 12);
            OutWav.BitsPerSample = ReadLe16(Format + 14);
            bFoundFormat = true;
        }
        else if (IsFourCc(Chunk, "data"))
        {
            if (bFoundData)
            {
                OutError = TEXT("The WAVE container has duplicate data chunks.");
                return false;
            }
            OutWav.PcmData.SetNumUninitialized(static_cast<int32>(ChunkSize));
            if (ChunkSize > 0)
            {
                FMemory::Memcpy(
                    OutWav.PcmData.GetData(),
                    Bytes.GetData() + DataStart,
                    ChunkSize);
            }
            bFoundData = true;
        }

        const uint64 Next = DataEnd + (ChunkSize & 1U);
        if (Next > static_cast<uint64>(MAX_int32))
        {
            OutError = TEXT("The WAVE chunk offset is out of range.");
            return false;
        }
        Offset = static_cast<int32>(Next);
    }

    if (Offset != Bytes.Num())
    {
        OutError = TEXT("The WAVE container has trailing or unpadded bytes.");
        return false;
    }

    if (!bFoundFormat || !bFoundData)
    {
        OutError = TEXT("The WAVE container needs fmt and data chunks.");
        return false;
    }
    if (AudioFormat != 1 || OutWav.BitsPerSample != 16)
    {
        OutError = TEXT("Only uncompressed 16-bit PCM WAVE audio is accepted.");
        return false;
    }
    if (OutWav.NumChannels < 1 || OutWav.NumChannels > 2 ||
        OutWav.SampleRate < 8000 || OutWav.SampleRate > 192000)
    {
        OutError = TEXT("Unsupported WAVE channel count or sample rate.");
        return false;
    }

    const int32 ExpectedBlockAlign = OutWav.NumChannels * 2;
    if (BlockAlign != ExpectedBlockAlign ||
        OutWav.PcmData.IsEmpty() ||
        OutWav.PcmData.Num() % ExpectedBlockAlign != 0)
    {
        OutError = TEXT("The WAVE PCM payload is not sample-aligned.");
        return false;
    }

    const double BytesPerSecond =
        static_cast<double>(OutWav.SampleRate) * ExpectedBlockAlign;
    OutWav.DurationSeconds = static_cast<float>(OutWav.PcmData.Num() / BytesPerSecond);
    return true;
}
