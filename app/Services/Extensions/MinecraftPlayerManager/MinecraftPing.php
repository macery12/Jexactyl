<?php

namespace Everest\Services\Extensions\MinecraftPlayerManager;

class MinecraftPing
{
    /** @var ?resource */
    private $Socket;
    private string $ServerAddress;
    private int $ServerPort;
    private float $Timeout;

    public function __construct(string $Address, int $Port = 25565, float $Timeout = 2, bool $ResolveSRV = true)
    {
        if ($Timeout < 0) {
            throw new \InvalidArgumentException('Timeout must be a positive integer.');
        }

        $this->ServerAddress = $Address;
        $this->ServerPort = $Port;
        $this->Timeout = $Timeout;

        if ($ResolveSRV) {
            $this->ResolveSRV();
        }
    }

    public function __destruct()
    {
        $this->Close();
    }

    public function Close(): void
    {
        if ($this->Socket !== null) {
            \fclose($this->Socket);
            $this->Socket = null;
        }
    }

    public function Connect(): void
    {
        $Socket = @\fsockopen($this->ServerAddress, $this->ServerPort, $errno, $errstr, $this->Timeout);

        if ($Socket === false) {
            throw new MinecraftPingException("Failed to connect or create a socket: $errno ($errstr)");
        }

        $this->Socket = $Socket;
        \stream_set_timeout($this->Socket, (int) $this->Timeout);
    }

    /** @return array|false */
    public function Query(): array|bool
    {
        if ($this->Socket === null) {
            throw new MinecraftPingException('Socket is not open.');
        }

        $TimeStart = \microtime(true);

        $Data = "\x00"; // packet ID = 0 (varint)
        $Data .= "\xff\xff\xff\xff\x0f"; // Protocol version (varint)
        $Data .= \pack('c', \strlen($this->ServerAddress)) . $this->ServerAddress;
        $Data .= \pack('n', $this->ServerPort);
        $Data .= "\x01"; // Next state: status (varint)

        $Data = \pack('c', \strlen($Data)) . $Data;

        fwrite($this->Socket, $Data . "\x01\x00");

        $Length = $this->ReadVarInt();

        if ($Length < 10) {
            return false;
        }

        $this->ReadVarInt(); // packet type

        $Length = $this->ReadVarInt(); // string length

        if ($Length < 2) {
            return false;
        }

        $Data = '';
        while (\strlen($Data) < $Length) {
            if (\microtime(true) - $TimeStart > $this->Timeout) {
                throw new MinecraftPingException('Server read timed out');
            }

            $Remainder = $Length - \strlen($Data);

            if ($Remainder <= 0) {
                break;
            }

            $block = \fread($this->Socket, $Remainder);
            if (!$block) {
                throw new MinecraftPingException('Server returned too few data');
            }

            $Data .= $block;
        }

        $Data = \json_decode($Data, true);

        if (\json_last_error() !== JSON_ERROR_NONE) {
            throw new MinecraftPingException('JSON parsing failed: ' . \json_last_error_msg());
        }

        if (!\is_array($Data)) {
            return false;
        }

        return $Data;
    }

    private function ReadVarInt(): int
    {
        $i = 0;
        $j = 0;

        while (true) {
            $k = @\fgetc($this->Socket);

            if ($k === false) {
                return 0;
            }

            $k = \ord($k);

            $i |= ($k & 0x7F) << $j++ * 7;

            if ($j > 5) {
                throw new MinecraftPingException('VarInt too big');
            }

            if (($k & 0x80) != 128) {
                break;
            }
        }

        return $i;
    }

    private function ResolveSRV(): void
    {
        if (\ip2long($this->ServerAddress) !== false) {
            return;
        }

        $Record = @\dns_get_record('_minecraft._tcp.' . $this->ServerAddress, DNS_SRV);

        if (empty($Record)) {
            return;
        }

        if (isset($Record[0]['target'])) {
            $this->ServerAddress = $Record[0]['target'];
        }

        if (isset($Record[0]['port'])) {
            $this->ServerPort = (int) $Record[0]['port'];
        }
    }
}
