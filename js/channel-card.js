// Web Component для карточки канала
class ChannelCard extends HTMLElement {
    constructor() {
        super();
    }
    
    connectedCallback() {
        const channelId = this.getAttribute('channel-id');
        const channelNumber = this.getAttribute('channel-number');
        const channelColor = this.getAttribute('channel-color');
        
        this.innerHTML = `
            <section class="channel" aria-labelledby="channel-title-${channelNumber}">
                <h2 id="channel-title-${channelNumber}">
                    <span class="channel-icon ${channelColor}" aria-hidden="true"></span> 
                    Канал ${channelNumber}
                </h2>
                <div class="input-group">
                    <label for="ace_id_${channelId}">Ace ID:</label>
                    <input type="text" id="ace_id_${channelId}" placeholder="Введите Ace ID" autocomplete="off">
                </div>
                <div class="input-group">
                    <label for="title_${channelId}">Название трансляции:</label>
                    <input type="text" id="title_${channelId}" placeholder="Введите название трансляции" autocomplete="off">
                </div>
                <div class="buttons-group">
                    <button class="btn-start" data-channel="${channelId}" aria-label="Запустить канал ${channelNumber}">▶ Запустить</button>
                    <button class="btn-stop" data-channel="${channelId}" aria-label="Остановить канал ${channelNumber}">⏹ Остановить</button>
                </div>
                <div class="channel-content">
                    <div class="status" id="status_${channelId}" role="status">Статус: Неизвестно</div>
                    <div class="logs-link">
                        <small>
                            <a href="/logs/${channelId}.log" target="_blank" title="Открыть логи в новой вкладке" aria-label="Логи канала ${channelNumber}">
                                Логи ${channelId}
                            </a>
                        </small>
                    </div>
                </div>
            </section>
        `;
    }
}

// Регистрация кастомного элемента
customElements.define('channel-card', ChannelCard);