<?php

namespace Everest\Services\Extensions\MinecraftPlayerManager;

class MinecraftQuery
{
    public const STATISTIC = 0x00;
    public const HANDSHAKE = 0x09;

    /** @var ?resource */
    private $Socket;
    private ?array $Players = null;
    private ?array $Info = null;

    public function Connect(string $Ip, int $Port = 25565, float $Timeout = 3, bool $ResolveSRV = true): void
    {
        if ($Timeout < 0) {
            throw new \InvalidArgumentException('Timeout must be a positive integer.');
        }

        if ($ResolveSRV) {
            $this->ResolveSRV($Ip, $Port);
        }

        $Socket = @\fsockopen('udp://' . $Ip, $Port, $ErrNo, $ErrStr, $Timeout);

        if ($ErrNo || $Socket === false) {
            throw new MinecraftQueryException('Could not create socket: ' . $ErrStr);
        }

        $this->Socket = $Socket;

        \stream_set_timeout($this->Socket, (int) $Timeout);
        \stream_set_blocking($this->Socket, true);

        try {
            $Challenge = $this->GetChallenge();
            $this->GetStatus($Challenge);
        } finally {
            \fclose($Socket);
        }
    }

    /** @return array|false */
    public function GetInfo(): array|bool
    {
        return $this->Info ?? false;
    }

    /** @return array|false */
    public function GetPlayers(): array|bool
    {
        return $this->Players ?? false;
    }

    private function GetChallenge(): string
    {
        $Data = $this->WriteData(self::HANDSHAKE);

        if ($Data === false) {
            throw new MinecraftQueryException('Failed to receive challenge.');
        }

        return \pack('N', $Data);
    }

    private function GetStatus(string $Challenge): void
    {
        $Data = $this->WriteData(self::STATISTIC, $Challenge . \pack('c*', 0x00, 0x00, 0x00, 0x00));

        if (!$Data) {
            throw new MinecraftQueryException('Failed to receive status.');
        }

        $Info = [];

        $Data = \substr($Data, 11);
        $Data = \explode("\x00\x00\x01player_\x00\x00", $Data);

        if (\count($Data) !== 2) {
            throw new MinecraftQueryException("Failed to parse server's response.");
        }

        $Players = \substr($Data[1], 0, -2);
        $Data = \explode("\x00", $Data[0]);

        $Keys = [
            'hostname' => 'HostName',
            'gametype' => 'GameType',
            'version' => 'Version',
            'plugins' => 'Plugins',
            'map' => 'Map',
            'numplayers' => 'Players',
            'maxplayers' => 'MaxPlayers',
            'hostport' => 'HostPort',
            'hostip' => 'HostIp',
            'game_id' => 'GameName',
        ];

        $Last = '';
        foreach ($Data as $Key => $Value) {
            if (~$Key & 1) {
                if (!isset($Keys[$Value])) {
                    $Last = false;
                    continue;
                }

                $Last = $Keys[$Value];
                $Info[$Last] = '';
            } elseif ($Last != false) {
                $Info[$Last] = \mb_convert_encoding($Value, 'UTF-8');
            }
        }

        $Info['Players'] = (int) ($Info['Players'] ?? 0);
        $Info['MaxPlayers'] = (int) ($Info['MaxPlayers'] ?? 0);
        $Info['HostPort'] = (int) ($Info['HostPort'] ?? 0);

        if (isset($Info['Plugins'])) {
            $Data = \explode(': ', $Info['Plugins'], 2);

            $Info['RawPlugins'] = $Info['Plugins'];
            $Info['Software'] = $Data[0];

            if (\count($Data) == 2) {
                $Info['Plugins'] = \explode('; ', $Data[1]);
            }
        } else {
            $Info['Software'] = 'Vanilla';
        }

        $this->Info = $Info;

        if (empty($Players)) {
            $this->Players = null;
        } else {
            $this->Players = \explode("\x00", $Players);
        }
    }

    private function WriteData(int $Command, string $Append = ''): mixed
    {
        if ($this->Socket === null) {
            throw new MinecraftQueryException('Socket is not open.');
        }

        $Command = \pack('c*', 0xFE, 0xFD, $Command, 0x01, 0x02, 0x03, 0x04) . $Append;
        $Length = \strlen($Command);

        if ($Length !== \fwrite($this->Socket, $Command, $Length)) {
            throw new MinecraftQueryException('Failed to write on socket.');
        }

        $Data = \fread($this->Socket, 4096);

        if (empty($Data)) {
            throw new MinecraftQueryException('Failed to read from socket.');
        }

        if (\strlen($Data) < 5 || $Data[0] != $Command[2]) {
            return false;
        }

        return \substr($Data, 5);
    }

    private function ResolveSRV(string &$Address, int &$Port): void
    {
        if (\ip2long($Address) !== false) {
            return;
        }

        $Record = @\dns_get_record('_minecraft._tcp.' . $Address, DNS_SRV);

        if (empty($Record)) {
            return;
        }

        if (isset($Record[0]['target'])) {
            $Address = $Record[0]['target'];
        }

        if (isset($Record[0]['port'])) {
            $Port = (int) $Record[0]['port'];
        }
    }
}
